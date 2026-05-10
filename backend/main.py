import os
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import anthropic

from services.rag_engine import RAGEngine
from services.ai_advisor import AIAdvisor
from services.email_cache import EmailCache
from routers import connection, emails

load_dotenv()

NEW_EMAIL_POLL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "120"))  # 2 min default


async def _poll_new_emails(rag: RAGEngine, cache: EmailCache):
    """Background task: check Inbox + Sent every POLL_INTERVAL_SECONDS for new emails."""
    await asyncio.sleep(30)  # initial delay — let startup complete
    while True:
        try:
            from routers.connection import load_config, _progress
            from services.email_provider import build_provider

            if _progress.status == "running":
                await asyncio.sleep(NEW_EMAIL_POLL_SECONDS)
                continue

            cfg = load_config()
            if not cfg:
                await asyncio.sleep(NEW_EMAIL_POLL_SECONDS)
                continue

            provider = build_provider(cfg)
            folders = provider.get_ingest_folders()
            known_ids = rag._known_ids()
            new_total = 0

            def check_folder(folder: str) -> int:
                count = 0
                seen = 0
                # Scan the most recent POLL_SCAN_LIMIT emails per folder
                # fetch_all yields one email at a time — collect up to limit
                POLL_SCAN_LIMIT = 100
                buffer = []
                for email, _ in provider.fetch_all(folder=folder, batch_size=POLL_SCAN_LIMIT):
                    if email.id not in known_ids:
                        buffer.append(email)
                    seen += 1
                    if seen >= POLL_SCAN_LIMIT:
                        break

                if buffer:
                    cache.save_batch(buffer)
                    for email in buffer:
                        if rag.ingest_email(email):
                            known_ids.add(email.id)
                            count += 1
                return count

            loop = asyncio.get_event_loop()
            for folder in folders:
                new_total += await loop.run_in_executor(None, check_folder, folder)

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
    app.state.cache = EmailCache()                        # must init before RAGEngine
    app.state.rag = RAGEngine(client, app.state.cache)   # RAG uses cache for FTS5
    app.state.advisor = AIAdvisor(client)

    # Start background new-email poller
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
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connection.router)
app.include_router(emails.router)


@app.get("/health")
async def health(request: Request):
    rag_stats = request.app.state.rag.stats()
    return {"status": "ok", **rag_stats}


@app.get("/api/stats")
async def stats(request: Request):
    rag: RAGEngine = request.app.state.rag
    cache = request.app.state.cache
    rag_stats = rag.stats()

    # Disk usage — ChromaDB + SQLite
    da_dir = Path.home() / ".director-assistant"
    db_bytes = sum(f.stat().st_size for f in da_dir.rglob("*") if f.is_file()) if da_dir.exists() else 0

    from routers.connection import _progress
    return {
        "rag": {
            "total_chunks": rag_stats["total_chunks"],
            "unique_emails_indexed": rag.count_unique_emails(),  # O(1) counter
            "cached_emails": cache.count(),                       # SQLite count, instant
            "db_size_mb": round(db_bytes / 1024 / 1024, 2),
        },
        "ingest": {
            "status": _progress.status,
            "processed": _progress.processed,
            "total": _progress.total,
            "message": _progress.message,
        },
    }
