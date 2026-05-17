import os
import asyncio
from contextlib import asynccontextmanager
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
from routers import connection, emails
from routers import digest, actions, followups, templates, analytics, sender, accounts as accounts_router
from routers import config as config_router
from routers import health as health_router
from routers import oauth as oauth_router
from routers import ask as ask_router
from routers import documents as documents_router
from routers import intelligence as intelligence_router
from services.intelligence_service import IntelligenceService
from routers.config import get_effective_api_key, load_app_config
from services.ai_client import AIClient

load_dotenv()

NEW_EMAIL_POLL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))
POLL_RECENT_N = 50
POLL_SINCE_DAYS = 7

_last_poll_time: str = ""
_last_poll_new: int = 0
_last_poll_error: str = ""

# Reuse provider instances across poll cycles so IMAP connections stay open.
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


def _get_ingest_folders(account_id: int, provider) -> list[str]:
    """Cache per-account folder list so each poll cycle avoids an IMAP LIST call."""
    if account_id not in _folder_cache:
        _folder_cache[account_id] = provider.get_ingest_folders()
    return _folder_cache[account_id]


def _is_connection_error(exc: Exception) -> bool:
    import imaplib
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, EOFError, TimeoutError, SystemError)):
        return True
    if isinstance(exc, imaplib.IMAP4.abort):
        return True
    if isinstance(exc, imaplib.IMAP4.error):
        return any(kw in str(exc).upper() for kw in ("EOF", "BYE", "CLOSED", "NONAUTH"))
    return False


async def _run_poll_cycle(rag: RAGEngine, cache: EmailCache) -> tuple[int, list[str]]:
    """
    One complete poll cycle: detect deletions, fetch new emails for all accounts.
    Returns (new_count, error_list). Updates _last_poll_* globals on completion.
    """
    global _last_poll_time, _last_poll_new, _last_poll_error

    from routers.connection import _progress, load_config
    from services.email_provider import build_provider, IMAPProvider  # IMAPProvider for isinstance check

    if _progress.status == "running":
        return 0, []

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
                providers_to_check.append((acc.id, _get_provider(acc.id, acc)))
            except Exception:
                pass
    else:
        legacy = load_config()
        if legacy:
            if 0 not in _provider_cache:
                _provider_cache[0] = build_provider(legacy)
            providers_to_check = [(0, _provider_cache[0])]

    known_ids = rag._known_ids()
    loop = asyncio.get_event_loop()

    # Accounts that have never completed a full ingest get fetch_all (no N cap, no date cap).
    never_ingested_ids: set[int] = {
        acc.id for acc in all_accounts if not acc.last_ingested
    }

    # Legacy single-account path: full sweep if the flag file doesn't exist yet
    from routers.connection import _LEGACY_INGESTED_FLAG
    legacy_needs_full_sweep = (len(all_accounts) == 0 and not _LEGACY_INGESTED_FLAG.exists())

    def check_folder(account_id: int, provider, folder: str, full_sweep: bool = False) -> int:
        # Step 1: detect server-side deletions (cheap UID list, no body download)
        try:
            server_uids = provider.get_uid_list(folder=folder, from_date=since_dt)
        except Exception as e:
            print(f"[poll] uid_list failed account={account_id} folder={folder}: {e}")
            server_uids = None

        if server_uids is not None and len(server_uids) > 0:
            # Only run deletion detection when server returned something.
            # An empty set likely means a transient auth/connection issue — skip
            # to avoid mass-deleting all cached emails.
            cached = cache.get_cached_server_ids(account_id, folder, since_str)
            for srv_id, cache_id in cached.items():
                if srv_id not in server_uids:
                    cache.delete_email(cache_id)
                    rag.remove_email(cache_id)
                    known_ids.discard(cache_id)
                    print(f"[poll] removed deleted email cache_id={cache_id}")

        # Step 2: fetch new emails
        # First-time accounts get a full unlimited sweep so nothing is missed.
        if full_sweep:
            fetch_fn = lambda: provider.fetch_all(folder=folder, batch_size=200)
        elif isinstance(provider, IMAPProvider):
            fetch_fn = lambda: provider.fetch_recent_n(folder=folder, n=POLL_RECENT_N, from_date=since_dt)
        else:
            fetch_fn = lambda: provider.fetch_all(folder=folder, batch_size=POLL_RECENT_N, from_date=since_dt)

        buffer = []
        for email, _ in fetch_fn():
            if account_id:
                email.server_id = email.id
                email.id = f"a{account_id}_{email.id}"
            if email.id not in known_ids:
                buffer.append(email)

        count = 0
        if buffer:
            cache.save_batch(buffer, account_id=account_id)
            for em in buffer:
                if rag.ingest_email(em):
                    known_ids.add(em.id)
                    count += 1
        return count

    new_total = 0
    errors: list[str] = []
    for account_id, provider in providers_to_check:
        try:
            full_sweep = (account_id in never_ingested_ids) or (account_id == 0 and legacy_needs_full_sweep)
            if full_sweep:
                print(f"[poll] account {account_id} has never been fully ingested — running full sweep")
            for folder in _get_ingest_folders(account_id, provider):
                new_total += await loop.run_in_executor(
                    None, check_folder, account_id, provider, folder, full_sweep
                )
            if full_sweep:
                if account_id != 0:
                    cache.mark_ingested(account_id)
                else:
                    _LEGACY_INGESTED_FLAG.touch(exist_ok=True)
                print(f"[poll] account {account_id} full sweep complete — marked as ingested")
        except Exception as e:
            if _is_connection_error(e):
                _evict_provider(account_id)   # next cycle will reconnect
                # For OAuth accounts, try refreshing the token so the next
                # reconnect uses a valid credential.
                acc_obj = next((a for a in all_accounts if a.id == account_id), None)
                if acc_obj and acc_obj.access_token:
                    new_token = cache.refresh_oauth_token(account_id)
                    if new_token:
                        print(f"[poll] refreshed oauth token for account {account_id}", flush=True)
            msg = f"account {account_id}: {type(e).__name__}: {e}"
            print(f"[poll] {msg}")
            errors.append(msg)

    if new_total > 0:
        rag.flush_bm25()
        print(f"[poll] {new_total} new email(s) indexed")

    _last_poll_time = datetime.now(timezone.utc).isoformat(timespec="seconds") + "Z"
    _last_poll_new = new_total
    _last_poll_error = "; ".join(errors) if errors else ""
    return new_total, errors


async def _poll_new_emails(rag: RAGEngine, cache: EmailCache):
    """Background loop: poll on a configurable interval, read from config each cycle."""
    global _last_poll_error
    await asyncio.sleep(20)   # let startup settle
    while True:
        interval = load_app_config().get("poll_interval_seconds", NEW_EMAIL_POLL_SECONDS)
        try:
            await _run_poll_cycle(rag, cache)
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
        _poll_new_emails(app.state.rag, app.state.cache)
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = load_app_config()
    anthropic_key = cfg.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY", "")
    openai_key = cfg.get("openai_api_key") or os.getenv("OPENAI_API_KEY", "")
    budget_mode = cfg.get("budget_mode", False)
    client = AIClient(anthropic_key=anthropic_key, openai_key=openai_key,
                      budget_mode=budget_mode)
    app.state.cache = EmailCache()
    app.state.rag = RAGEngine(client, app.state.cache)
    app.state.advisor = AIAdvisor(client)
    app.state.digest = DigestService(client)
    app.state.classifier = ClassifierService(client)
    app.state.intelligence = IntelligenceService(client, app.state.cache, app.state.rag)

    app.state.poll_task = asyncio.create_task(
        _poll_new_emails(app.state.rag, app.state.cache)
    )
    app.state.restart_poll = lambda: asyncio.create_task(_restart_poll(app))
    yield
    app.state.poll_task.cancel()
    try:
        await app.state.poll_task
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
app.include_router(emails.router)
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
            "interval_seconds": NEW_EMAIL_POLL_SECONDS,
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
    """Manually trigger one poll cycle immediately (used by Refresh button)."""
    rag: RAGEngine = request.app.state.rag
    cache = request.app.state.cache
    asyncio.create_task(_run_poll_cycle(rag, cache))
    return {"status": "polling"}


# Serve built frontend from backend/static/ (production mode)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
