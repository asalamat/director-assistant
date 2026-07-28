"""Email polling infrastructure — provider cache + poll-cycle engine.

Plain module (not a FastAPI router). main.py imports this module and reads the
poll-status globals via attribute access (poll._last_poll_time, etc.) because
they are reassigned inside _do_poll_cycle_inner and a bound `from ... import`
would not observe the updates.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI
from services.rag_engine import RAGEngine
from services.email_cache import EmailCache
from routers.config import load_app_config

NEW_EMAIL_POLL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))
POLL_RECENT_N = 20
POLL_SINCE_DAYS = 7

_last_poll_time: str = ""
_last_poll_new: int = 0
_last_poll_error: str = ""
_poll_lock: asyncio.Lock = asyncio.Lock()  # replaces _poll_running boolean; safe for asyncio concurrency

_URGENT_KEYWORDS = frozenset({
    "urgent", "asap", "deadline", "action required", "time-sensitive",
    "immediately", "critical", "time sensitive", "respond by", "due today",
    "overdue", "emergency", "important",
})


def _is_high_priority(email) -> bool:
    return any(kw in (email.subject or "").lower() for kw in _URGENT_KEYWORDS)


# ── Provider cache ────────────────────────────────────────────────────────────
# Key 0 is reserved for the legacy single-account config.
_provider_cache: dict[int, object] = {}
_folder_cache: dict[int, list[str]] = {}   # avoid IMAP LIST on every poll cycle


def _get_provider(account_id: int, acc):
    if account_id not in _provider_cache:
        from services.email_provider import build_provider
        _provider_cache[account_id] = build_provider(acc.to_connection_config())
    return _provider_cache[account_id]


def _evict_provider(account_id: int):
    """Remove and cleanly disconnect a cached provider."""
    p = _provider_cache.pop(account_id, None)
    _folder_cache.pop(account_id, None)
    if p is not None and hasattr(p, "disconnect"):
        try:
            p.disconnect()
        except Exception:
            pass


def _get_ingest_folders(account_id: int, provider, full_sweep: bool = False) -> list[str]:
    if full_sweep:
        return provider.get_ingest_folders()
    if account_id not in _folder_cache:
        _folder_cache[account_id] = provider.get_poll_folders()
    return _folder_cache[account_id]


def _check_folder(
    account_id: int, provider, folder: str,
    cache, rag, known_ids: set, all_new_emails: list,
    since_dt, since_str, full_sweep: bool = False,
) -> int:
    from services.email_provider import IMAPProvider
    if full_sweep:
        try:
            server_uids = provider.get_uid_list(folder=folder, from_date=since_dt)
        except Exception as e:
            print(f"[poll] uid_list failed account={account_id} folder={folder}: {e}")
            server_uids = None
        if server_uids is not None and len(server_uids) > 0:
            cached = cache.get_cached_server_ids(account_id, folder, since_str)
            for srv_id, cache_id in cached.items():
                if srv_id not in server_uids:
                    cache.delete_email(cache_id)
                    rag.remove_email(cache_id)
                    known_ids.discard(cache_id)
    if full_sweep:
        fetch_fn = lambda: provider.fetch_all(folder=folder, batch_size=200)
    elif isinstance(provider, IMAPProvider):
        fetch_fn = lambda: provider.fetch_recent_n(folder=folder, n=POLL_RECENT_N, from_date=since_dt)
    else:
        fetch_fn = lambda: provider.fetch_all(folder=folder, batch_size=POLL_RECENT_N, from_date=since_dt)
    buffer = []
    try:
        for email, _ in fetch_fn():
            if account_id:
                email.server_id = email.id
                email.id = f"a{account_id}_{email.id}"
            if email.id not in known_ids:
                buffer.append(email)
    except Exception as e:
        import imaplib as _imap
        if isinstance(e, _imap.IMAP4.abort):
            raise
        print(f"[poll] fetch error account={account_id} folder={folder}: {e}")
    count = 0
    if buffer:
        cache.save_batch(buffer, account_id=account_id)
        for em in buffer:
            if rag.ingest_email(em):
                known_ids.add(em.id)
                all_new_emails.append(em)
                count += 1
    return count


def _is_connection_error(exc: Exception) -> bool:
    import imaplib
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, EOFError, TimeoutError, SystemError)):
        return True
    if isinstance(exc, imaplib.IMAP4.abort):
        return True
    if isinstance(exc, imaplib.IMAP4.error):
        return any(kw in str(exc).upper() for kw in ("EOF", "BYE", "CLOSED", "NONAUTH"))
    try:
        import httpx
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 401:
            return True
    except ImportError:
        pass
    return False


async def _do_poll_cycle(rag: RAGEngine, cache: EmailCache, app=None) -> tuple[int, list[str]]:
    async with _poll_lock:
        return await _do_poll_cycle_inner(rag, cache, app)


async def _do_poll_cycle_inner(rag: RAGEngine, cache: EmailCache, app=None) -> tuple[int, list[str]]:
    global _last_poll_new, _last_poll_error, _last_poll_time
    from routers.connection import load_config
    from services.email_provider import build_provider, IMAPProvider

    cfg = load_app_config()
    sync_days = cfg.get("sync_window_days", POLL_SINCE_DAYS)
    if sync_days == 0:
        since_dt = None   # unlimited — no date filter
        since_str = None
    else:
        since_dt = datetime.now(timezone.utc) - timedelta(days=sync_days)
        since_str = since_dt.strftime("%Y-%m-%d")

    all_accounts = cache.list_accounts()
    providers_to_check: list[tuple[int, object]] = []
    if all_accounts:
        # Evict cached providers for accounts that have been removed
        current_ids = {acc.id for acc in all_accounts}
        for stale_id in set(_provider_cache.keys()) - current_ids:
            _evict_provider(stale_id)
        for acc in all_accounts:
            try:
                p = _get_provider(acc.id, acc)
                # Reset connection at start of each poll cycle — Yahoo (and others)
                # terminate idle IMAP sessions, causing NONAUTH on reuse.
                if hasattr(p, '_mail'):
                    p._mail = None
                providers_to_check.append((acc.id, p))
            except Exception as e:
                print(f"[poll] skipping account {acc.id} ({acc.username}): failed to build provider: {e}")
    else:
        legacy = load_config()
        if legacy:
            if 0 not in _provider_cache:
                _provider_cache[0] = build_provider(legacy)
            p = _provider_cache[0]
            if hasattr(p, '_mail'):
                p._mail = None
            providers_to_check = [(0, p)]

    known_ids = rag._known_ids()
    loop = asyncio.get_running_loop()

    # Accounts that have never completed a full ingest get fetch_all (no N cap, no date cap).
    never_ingested_ids: set[int] = {
        acc.id for acc in all_accounts if not acc.last_ingested
    }

    # Legacy single-account path: full sweep if the flag file doesn't exist yet
    _LEGACY_INGESTED_FLAG = Path.home() / ".director-assistant" / ".legacy_ingested"
    legacy_needs_full_sweep = (len(all_accounts) == 0 and not _LEGACY_INGESTED_FLAG.exists())

    # _check_folder is a module-level function — explicit params, no closure over outer state

    new_total = 0
    all_new_emails: list = []   # collected across all folders for auto-recommendation
    errors: list[str] = []
    for account_id, provider in providers_to_check:
        acc_obj = next((a for a in all_accounts if a.id == account_id), None)
        # Up to 2 attempts: if stale connection (NONAUTH/EOF/etc) reconnect and retry once.
        for attempt in range(2):
            try:
                full_sweep = (account_id in never_ingested_ids) or (account_id == 0 and legacy_needs_full_sweep)
                if full_sweep and attempt == 0:
                    print(f"[poll] account {account_id} first-time sweep — marking ingested now so future polls use fast path")
                    # Mark ingested before the sweep so timeouts don't cause infinite full-sweep retries
                    if account_id != 0:
                        cache.mark_ingested(account_id)
                    else:
                        _LEGACY_INGESTED_FLAG.touch(exist_ok=True)
                # Run folder-list in executor so blocking IMAP LIST doesn't stall the event loop
                folders = await asyncio.wait_for(
                    loop.run_in_executor(None, _get_ingest_folders, account_id, provider, full_sweep),
                    timeout=30,
                )
                for folder in folders:
                    try:
                        new_total += await asyncio.wait_for(
                            loop.run_in_executor(None, _check_folder, account_id, provider, folder,
                                                 cache, rag, known_ids, all_new_emails,
                                                 since_dt, since_str, full_sweep),
                            timeout=45,
                        )
                    except asyncio.TimeoutError:
                        errors.append(f"account {account_id} folder {folder}: timeout")
                        print(f"[poll] check_folder timed out account={account_id} folder={folder} — skipping")
                break  # success — exit retry loop
            except Exception as e:
                if attempt == 0 and _is_connection_error(e):
                    print(f"[poll] stale connection for account {account_id} ({e}) — reconnecting")
                    _evict_provider(account_id)
                    # For OAuth accounts refresh the token before reconnecting
                    if acc_obj and acc_obj.access_token:
                        new_token = cache.refresh_oauth_token(account_id)
                        if new_token:
                            print(f"[poll] refreshed oauth token for account {account_id}", flush=True)
                    # Build fresh provider for retry
                    try:
                        provider = _get_provider(account_id, acc_obj) if acc_obj else None
                        if provider is None:
                            raise RuntimeError("no provider")
                        _folder_cache.pop(account_id, None)  # clear folder cache too
                        continue  # retry with fresh connection
                    except Exception as conn_e:
                        errors.append(f"account {account_id}: reconnect failed: {conn_e}")
                        break
                msg = f"account {account_id}: {type(e).__name__}: {e}"
                print(f"[poll] {msg}")
                errors.append(msg)
                break

    if new_total > 0:
        rag.flush_bm25()
        print(f"[poll] {new_total} new email(s) indexed")
        if app is not None and all_new_emails:
            from workers.background_tasks import (
                _auto_recommend, _auto_deadline_extract, _auto_cluster_alert,
                _auto_sentiment_escalation, _auto_autopilot,
            )
            asyncio.create_task(_auto_recommend(app, all_new_emails))
            asyncio.create_task(_auto_deadline_extract(app, all_new_emails))
            asyncio.create_task(_auto_cluster_alert(app, all_new_emails))
            asyncio.create_task(_auto_sentiment_escalation(app, all_new_emails))
            asyncio.create_task(_auto_autopilot(app, all_new_emails))
            # Auto-label new emails immediately (don't wait for the hourly loop)
            async def _label_new(a=app, emails=all_new_emails):
                try:
                    clf = a.state.classifier
                    ch = a.state.cache
                    for em in emails[:20]:  # cap at 20 per poll to avoid API cost spikes
                        if not ch.get_category(em.id):
                            cat = await clf.classify(em.id, em.subject or "", em.sender or "",
                                                     (em.body or "")[:200])
                            ch.set_category(em.id, cat)
                except Exception:
                    pass
            asyncio.create_task(_label_new())
            # Apply email rules to new emails
            from routers.email_rules import apply_rules
            for em in all_new_emails:
                try:
                    apply_rules(em, cache)
                except Exception:
                    pass

    try:
        woken = cache.wake_due_snoozed()
        if woken:
            print(f"[poll] woke {len(woken)} snoozed email(s)")
    except Exception as e:
        print(f"[poll] wake-due check failed: {e}")

    _last_poll_new = new_total
    _last_poll_error = "; ".join(errors) if errors else ""
    _last_poll_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return new_total, errors


async def _poll_new_emails(rag: RAGEngine, cache: EmailCache, app=None):
    """Background loop: poll on a configurable interval, read from config each cycle."""
    global _last_poll_error
    await asyncio.sleep(20)   # let startup settle
    while True:
        interval = load_app_config().get("poll_interval_seconds", NEW_EMAIL_POLL_SECONDS)
        try:
            await _do_poll_cycle(rag, cache, app)
        except Exception as e:
            _last_poll_error = str(e)
            print(f"[poll error] {e}")
        await asyncio.sleep(interval)


async def _restart_poll(app: FastAPI):
    """Cancel the running poll task and start a fresh one (picks up new interval)."""
    task: asyncio.Task | None = getattr(app.state, "poll_task", None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    app.state.poll_task = asyncio.create_task(
        _poll_new_emails(app.state.rag, app.state.cache, app)
    )
