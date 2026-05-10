import os
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import anthropic

from services.rag_engine import RAGEngine
from services.ai_advisor import AIAdvisor
from services.email_cache import EmailCache
from services.digest import DigestService
from services.classifier import ClassifierService
from routers import connection, emails
from routers import digest, actions, followups, templates, analytics, sender, accounts as accounts_router

load_dotenv()

NEW_EMAIL_POLL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))   # default 1 min
POLL_RECENT_N = 50          # newest N emails to inspect per folder per poll
POLL_SINCE_DAYS = 7         # server-side SINCE window — avoids downloading old emails


_last_poll_time: str = ""   # ISO timestamp of the last successful poll cycle
_last_poll_new: int = 0     # how many new emails were found last poll


async def _poll_new_emails(rag: RAGEngine, cache: EmailCache):
    """Background: every POLL_INTERVAL_SECONDS, fetch newest emails from all accounts
    and ingest any that aren't already in RAG."""
    global _last_poll_time, _last_poll_new
    from datetime import datetime, timedelta

    await asyncio.sleep(20)   # short initial delay — let startup settle

    while True:
        try:
            from routers.connection import _progress, load_config
            from services.email_provider import build_provider, IMAPProvider, Office365Provider

            if _progress.status == "running":
                await asyncio.sleep(NEW_EMAIL_POLL_SECONDS)
                continue

            known_ids = rag._known_ids()
            new_total = 0
            since_dt = datetime.utcnow() - timedelta(days=POLL_SINCE_DAYS)

            all_accounts = cache.list_accounts()
            providers_to_check = []
            if all_accounts:
                for acc in all_accounts:
                    try:
                        providers_to_check.append((acc.id, build_provider(acc.to_connection_config())))
                    except Exception:
                        pass
            else:
                cfg = load_config()
                if cfg:
                    providers_to_check = [(0, build_provider(cfg))]

            loop = asyncio.get_event_loop()

            def check_folder(account_id: int, provider, folder: str) -> int:
                buffer = []
                fetch_fn = (
                    lambda: provider.fetch_recent_n(folder=folder, n=POLL_RECENT_N, from_date=since_dt)
                    if isinstance(provider, IMAPProvider)
                    # Office365: fetch_all with since_dt returns newest N via Graph pagination
                    else provider.fetch_all(folder=folder, batch_size=POLL_RECENT_N, from_date=since_dt)
                )
                for email, _ in fetch_fn():
                    if account_id:
                        email._server_id = email.id  # type: ignore[attr-defined]
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

            for account_id, provider in providers_to_check:
                try:
                    folders = provider.get_ingest_folders()
                    for folder in folders:
                        new_total += await loop.run_in_executor(
                            None, check_folder, account_id, provider, folder
                        )
                except Exception as e:
                    print(f"[poll] account {account_id} error: {e}")

            if new_total > 0:
                rag.flush_bm25()
                print(f"[poll] {new_total} new email(s) indexed")

            _last_poll_time = datetime.utcnow().isoformat(timespec="seconds") + "Z"
            _last_poll_new = new_total

        except Exception as e:
            print(f"[poll error] {e}")

        await asyncio.sleep(NEW_EMAIL_POLL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    client = anthropic.AsyncAnthropic(api_key=api_key)
    app.state.cache = EmailCache()
    app.state.rag = RAGEngine(client, app.state.cache)
    app.state.advisor = AIAdvisor(client)
    app.state.digest = DigestService(client)
    app.state.classifier = ClassifierService(client)

    poll_task = asyncio.create_task(
        _poll_new_emails(app.state.rag, app.state.cache)
    )
    yield
    poll_task.cancel()
    try:
        await poll_task
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
    # Run in background so the response is instant
    asyncio.create_task(_poll_new_emails_once(rag, cache))
    return {"status": "polling"}


async def _poll_new_emails_once(rag: RAGEngine, cache: EmailCache):
    """Single poll cycle — same logic as the loop but runs once."""
    global _last_poll_time, _last_poll_new
    from datetime import datetime, timedelta
    from routers.connection import _progress, load_config
    from services.email_provider import build_provider, IMAPProvider

    if _progress.status == "running":
        return

    known_ids = rag._known_ids()
    new_total = 0
    since_dt = datetime.utcnow() - timedelta(days=POLL_SINCE_DAYS)

    all_accounts = cache.list_accounts()
    providers_to_check = []
    if all_accounts:
        for acc in all_accounts:
            try:
                providers_to_check.append((acc.id, build_provider(acc.to_connection_config())))
            except Exception:
                pass
    else:
        cfg = load_config()
        if cfg:
            providers_to_check = [(0, build_provider(cfg))]

    loop = asyncio.get_event_loop()

    def check_folder(account_id: int, provider, folder: str) -> int:
        buffer = []
        fetch_fn = (
            lambda: provider.fetch_recent_n(folder=folder, n=POLL_RECENT_N, from_date=since_dt)
            if isinstance(provider, IMAPProvider)
            else provider.fetch_all(folder=folder, batch_size=POLL_RECENT_N, from_date=since_dt)
        )
        for email, _ in fetch_fn():
            if account_id:
                email._server_id = email.id  # type: ignore[attr-defined]
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

    for account_id, provider in providers_to_check:
        try:
            for folder in provider.get_ingest_folders():
                new_total += await loop.run_in_executor(None, check_folder, account_id, provider, folder)
        except Exception as e:
            print(f"[poll-now] account {account_id} error: {e}")

    if new_total > 0:
        rag.flush_bm25()

    _last_poll_time = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    _last_poll_new = new_total
    print(f"[poll-now] {new_total} new email(s) indexed")


# Serve built frontend from backend/static/ (production mode)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
