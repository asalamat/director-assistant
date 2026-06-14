import os
import signal
import threading
import asyncio
from contextlib import asynccontextmanager

# Must be set before any ML library imports to prevent segfaults on Python 3.13 + hnswlib
for _k in ("TOKENIZERS_PARALLELISM", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS",
           "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_k, "1" if _k != "TOKENIZERS_PARALLELISM" else "false")
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from services.rag_engine import RAGEngine
from services.ai_advisor import AIAdvisor
from services.email_cache import EmailCache
from services.digest import DigestService
from services.classifier import ClassifierService
from routers import connection
from routers import email_list as email_list_router
from routers import email_ai as email_ai_router
from routers import email_actions as email_actions_router
from routers import digest, actions, followups, templates, analytics, sender, accounts as accounts_router
from routers import config as config_router
from routers import health as health_router
from routers import oauth as oauth_router
from routers import ask as ask_router
from routers import documents as documents_router
from routers import intelligence as intelligence_router
from routers import snooze as snooze_router
from routers import saved_searches as saved_searches_router
from routers import drafts as drafts_router
from routers import email_send as email_send_router
from routers import update as update_router
from routers import dashboard as dashboard_router
from routers import triage as triage_router
from routers import triage_rules as triage_rules_router
from routers import proactive as proactive_router
from routers import scheduled_send as scheduled_send_router
from routers import pst_import as pst_import_router
from routers import weekly_brief as weekly_brief_router
from routers import vip as vip_router
from routers import projects as projects_router
from routers import contacts as contacts_router
from routers import meeting as meeting_router
from routers import crm as crm_router
from routers import notify as notify_router
from routers import backup as backup_router
from routers import tasks_export as tasks_export_router
from routers import webhooks as webhooks_router
from routers import report_schedule as report_schedule_router
from routers import delegations as delegations_router
from routers import overnight as overnight_router
from routers import email_rules as email_rules_router
from routers import voice as voice_router
from routers import signatures as signatures_router
from routers import snippets as snippets_router
from routers import rag as rag_router
from routers import knowledge_graph as knowledge_graph_router
from routers.proactive import push_alert
from services.intelligence_service import IntelligenceService
from workers.background_tasks import (
    _auto_recommend, _auto_deadline_extract, _auto_cluster_alert,
    _auto_sentiment_escalation, _commitment_scan_loop,
    _relationship_health_loop, _auto_label_loop, _scheduled_send_loop,
    _scheduled_report_loop, _overnight_triage_loop,
)
from routers.config import get_effective_api_key, load_app_config
from services.ai_client import AIClient

load_dotenv()

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


# Background tasks moved to workers/background_tasks.py

async def _do_poll_cycle(rag: RAGEngine, cache: EmailCache, app=None) -> tuple[int, list[str]]:
    async with _poll_lock:
        return await _do_poll_cycle_inner(rag, cache, app)


async def _do_poll_cycle_inner(rag: RAGEngine, cache: EmailCache, app=None) -> tuple[int, list[str]]:
    global _last_poll_new, _last_poll_error
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
    loop = asyncio.get_event_loop()

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
            asyncio.create_task(_auto_recommend(app, all_new_emails))
            asyncio.create_task(_auto_deadline_extract(app, all_new_emails))
            asyncio.create_task(_auto_cluster_alert(app, all_new_emails))
            asyncio.create_task(_auto_sentiment_escalation(app, all_new_emails))
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

    _last_poll_new = new_total
    _last_poll_error = "; ".join(errors) if errors else ""
    return new_total, errors


async def _send_scheduled_digest(app: FastAPI):
    """Generate and send the daily digest email via SMTP."""
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from datetime import date as _date
    from routers.config import load_app_config
    from routers.email_send import _smtp_send

    cfg = load_app_config()
    to_email = cfg.get("digest_schedule_email", "")
    if not to_email:
        return

    digest_svc = app.state.digest
    cache = app.state.cache
    try:
        digest = await digest_svc.generate(cache, hours=24)
    except Exception as e:
        print(f"[digest-scheduler] generate failed: {e}")
        return

    accounts = cache.list_accounts()
    smtp_acc = next((a for a in accounts if getattr(a, "password", None)), None)
    if not smtp_acc:
        print("[digest-scheduler] no SMTP account — skipping send")
        return

    subject = f"Director Assistant Digest — {_date.today().strftime('%A, %B %d')}"
    lines = [digest.get("summary", ""), ""]
    if digest.get("top_action_items"):
        lines += ["Action Items:"] + [f"• {a}" for a in digest["top_action_items"][:5]] + [""]
    if digest.get("highlights"):
        lines += ["Highlights:"] + [f"• {h}" for h in digest["highlights"][:5]]
    body = "\n".join(lines)

    msg = MIMEMultipart()
    msg["From"] = smtp_acc.username
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _smtp_send, smtp_acc, msg)
    print(f"[digest-scheduler] digest sent to {to_email}")


async def _digest_scheduler(app: FastAPI):
    """Background loop: send digest at configured time once per day."""
    from routers.config import load_app_config, save_app_config
    from datetime import datetime as _dt
    await asyncio.sleep(30)
    while True:
        await asyncio.sleep(60)
        try:
            cfg = load_app_config()
            if not cfg.get("digest_schedule_enabled"):
                continue
            schedule_time = cfg.get("digest_schedule_time", "08:00")
            now = _dt.now()
            current_time = now.strftime("%H:%M")
            today_str = now.strftime("%Y-%m-%d")
            if current_time == schedule_time and cfg.get("digest_last_sent") != today_str:
                await _send_scheduled_digest(app)
                cfg["digest_last_sent"] = today_str
                save_app_config(cfg)
        except Exception as e:
            print(f"[digest-scheduler] error: {e}")


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Orphaned RAG worker cleanup is handled by rag_proxy._kill_old_worker() via pidfile.

    try:
        import torch
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
    except Exception:
        pass

    cfg = load_app_config()
    anthropic_key = cfg.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY", "")
    openai_key = cfg.get("openai_api_key") or os.getenv("OPENAI_API_KEY", "")
    budget_mode = cfg.get("budget_mode", False)
    ai_providers = cfg.get("ai_providers")  # multi-provider list (new)
    client = AIClient(
        anthropic_key=anthropic_key,
        openai_key=openai_key,
        budget_mode=budget_mode,
        providers=ai_providers,  # None = use legacy two-key mode
    )
    app.state.cache = EmailCache()
    app.state.rag = RAGEngine(client, app.state.cache)
    app.state.advisor = AIAdvisor(client, rag=app.state.rag)
    app.state.digest = DigestService(client)
    app.state.classifier = ClassifierService(client)
    app.state.intelligence = IntelligenceService(client, app.state.cache, app.state.rag)

    # Index contact notes into RAG so Ask tab can search them
    try:
        app.state.rag.ingest_contacts(app.state.cache)
    except Exception:
        pass

    app.state.proactive_alerts = []   # in-memory proactive alert feed
    app.state.poll_task = asyncio.create_task(
        _poll_new_emails(app.state.rag, app.state.cache, app)
    )
    app.state.digest_task = asyncio.create_task(_digest_scheduler(app))
    app.state.commitment_task = asyncio.create_task(_commitment_scan_loop(app))
    app.state.relationship_task = asyncio.create_task(_relationship_health_loop(app))
    app.state.scheduled_send_task = asyncio.create_task(_scheduled_send_loop(app))
    app.state.report_task = asyncio.create_task(_scheduled_report_loop(app))
    app.state.auto_label_task = asyncio.create_task(_auto_label_loop(app))
    app.state.overnight_task = asyncio.create_task(_overnight_triage_loop(app))
    app.state.restart_poll = lambda: asyncio.create_task(_restart_poll(app))
    yield
    for task_name in ("digest_task", "poll_task", "commitment_task", "relationship_task",
                      "scheduled_send_task", "auto_label_task", "report_task", "overnight_task"):
        task = getattr(app.state, task_name, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(title="Director Assistant API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connection.router)
app.include_router(email_list_router.router)
app.include_router(email_ai_router.router)
app.include_router(email_actions_router.router)
app.include_router(digest.router)
app.include_router(actions.router)
app.include_router(followups.router)
app.include_router(templates.router)
app.include_router(analytics.router)
app.include_router(sender.router)
app.include_router(accounts_router.router)
app.include_router(config_router.router)
app.include_router(health_router.router)
app.include_router(oauth_router.router)
app.include_router(ask_router.router)
app.include_router(documents_router.router)
app.include_router(intelligence_router.router)
app.include_router(snooze_router.router)
app.include_router(saved_searches_router.router)
app.include_router(drafts_router.router)
app.include_router(email_send_router.router)
app.include_router(update_router.router)
app.include_router(dashboard_router.router)
app.include_router(triage_router.router)
app.include_router(triage_rules_router.router)
app.include_router(proactive_router.router)
app.include_router(scheduled_send_router.router)
app.include_router(pst_import_router.router)
app.include_router(weekly_brief_router.router)
app.include_router(vip_router.router)
app.include_router(contacts_router.router)
app.include_router(projects_router.router)
app.include_router(meeting_router.router)
app.include_router(crm_router.router)
app.include_router(tasks_export_router.router)
app.include_router(webhooks_router.router)
app.include_router(report_schedule_router.router)
app.include_router(notify_router.router)
app.include_router(backup_router.router)
app.include_router(delegations_router.router)
app.include_router(overnight_router.router)
app.include_router(email_rules_router.router)
app.include_router(voice_router.router)
app.include_router(signatures_router.router)
app.include_router(snippets_router.router)
app.include_router(rag_router.router)
app.include_router(knowledge_graph_router.router)


@app.get("/health")
async def health(request: Request):
    rag_stats = request.app.state.rag.stats()
    return {"status": "ok", **rag_stats}


@app.get("/api/stats")
async def stats(request: Request):
    rag: RAGEngine = request.app.state.rag
    cache = request.app.state.cache
    rag_stats = rag.stats()

    da_dir = Path.home() / ".director-assistant"
    db_bytes = sum(f.stat().st_size for f in da_dir.rglob("*") if f.is_file()) if da_dir.exists() else 0

    from routers.connection import _progress
    accounts = cache.list_accounts()
    cfg = load_app_config()
    return {
        "rag": {
            "total_chunks": rag_stats["total_chunks"],
            "unique_emails_indexed": rag.count_unique_emails(),
            "cached_emails": cache.count(),
            "db_size_mb": round(db_bytes / 1024 / 1024, 2),
        },
        "ingest": {
            "status": _progress.status,
            "processed": _progress.processed,
            "total": _progress.total,
            "message": _progress.message,
        },
        "poll": {
            "interval_seconds": cfg.get("poll_interval_seconds", NEW_EMAIL_POLL_SECONDS),
            "last_checked": _last_poll_time,
            "last_new": _last_poll_new,
            "last_error": _last_poll_error,
        },
        "accounts": [
            {"id": a.id, "username": a.username, "provider": a.provider,
             "last_ingested": a.last_ingested}
            for a in accounts
        ],
    }


@app.post("/api/poll/now")
async def poll_now(request: Request):
    """Manually trigger a poll cycle (used by Refresh button).

    Waits up to 15 s for any in-progress background poll to finish so the
    fresh cycle can see emails that arrived after the background cycle started.
    """
    rag: RAGEngine = request.app.state.rag
    cache = request.app.state.cache
    # Wait for any running poll to finish (up to 15 s) before starting a fresh one.
    for _ in range(30):
        if not _poll_lock.locked():
            break
        await asyncio.sleep(0.5)
    new_count, _ = await _do_poll_cycle(rag, cache)
    return {"status": "done", "new_count": new_count}


@app.post("/api/shutdown")
async def shutdown():
    """Gracefully terminate the application process."""
    threading.Timer(0.3, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()
    return {"status": "shutting_down"}


@app.post("/api/badge/{count}")
async def set_dock_badge(count: int):
    """Set the macOS dock badge to the given unread count."""
    try:
        from AppKit import NSApplication  # type: ignore
        ns_app = NSApplication.sharedApplication()
        label = str(count) if count > 0 else ""
        ns_app.dockTile().setBadgeLabel_(label)
    except Exception:
        pass
    return {"ok": True}


# Serve built frontend from backend/static/ (production mode)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
