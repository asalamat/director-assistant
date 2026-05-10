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

NEW_EMAIL_POLL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "120"))
POLL_SCAN_LIMIT = 100


async def _poll_new_emails(rag: RAGEngine, cache: EmailCache):
    """Background task: check all accounts for new emails every POLL_INTERVAL_SECONDS."""
    await asyncio.sleep(30)
    while True:
        try:
            from routers.connection import _progress, load_config
            from services.email_provider import build_provider

            if _progress.status == "running":
                await asyncio.sleep(NEW_EMAIL_POLL_SECONDS)
                continue

            known_ids = rag._known_ids()
            new_total = 0

            all_accounts = cache.list_accounts()

            # Build provider list: prefer accounts table, fall back to config.json
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
                count = 0
                seen = 0
                buffer = []
                for email, _ in provider.fetch_all(folder=folder, batch_size=POLL_SCAN_LIMIT):
                    if account_id:
                        email._server_id = email.id  # type: ignore[attr-defined]
                        email.id = f"a{account_id}_{email.id}"
                    if email.id not in known_ids:
                        buffer.append(email)
                    seen += 1
                    if seen >= POLL_SCAN_LIMIT:
                        break

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
    }


# Serve built frontend from backend/static/ (production mode)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
