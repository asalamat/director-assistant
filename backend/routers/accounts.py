"""Multi-account management: add / list / remove email accounts."""

import asyncio
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import StreamingResponse

from models import Account, IngestProgress
from services.email_provider import build_provider

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

# Shared progress (same object as connection router uses)
_ingest_progress: IngestProgress = IngestProgress()


def get_progress() -> IngestProgress:
    return _ingest_progress


def set_progress(p: IngestProgress):
    global _ingest_progress
    _ingest_progress = p


def _safe(account):
    """Return account dict without credentials."""
    d = account.model_dump()
    for field in ("password", "client_secret"):
        if d.get(field):
            d[field] = "••••••"
    return d


@router.get("")
async def list_accounts(request: Request):
    return [_safe(a) for a in request.app.state.cache.list_accounts()]


@router.post("")
async def add_account(account: Account, request: Request):
    cache = request.app.state.cache

    cfg = account.to_connection_config()
    try:
        build_provider(cfg).test_connection()
    except Exception as e:
        msg = str(e).strip("b'\"")   # strip Python bytes repr e.g. b'LOGIN failed.'
        raise HTTPException(400, f"Connection failed: {msg}")

    aid = cache.add_account(account)
    return {"id": aid, "status": "connected"}


@router.delete("/{account_id}")
async def remove_account(account_id: int, request: Request):
    if not request.app.state.cache.remove_account(account_id):
        raise HTTPException(404, "Account not found")
    return {"ok": True}


async def _ingest_account(account: Account, rag, cache):
    """Ingest a single account's Inbox + Sent into RAG."""
    global _ingest_progress
    from datetime import datetime
    import traceback

    cfg = account.to_connection_config()
    provider = build_provider(cfg)
    folders = provider.get_ingest_folders()
    BATCH = 500
    total_new = 0
    total_skip = 0

    try:
        loop = asyncio.get_event_loop()

        def fetch_folder(folder: str):
            nonlocal total_new, total_skip
            _ingest_progress.message = f"[{account.username}] {folder}…"
            buffer = []
            for email, total in provider.fetch_all(folder=folder, batch_size=100):
                # Prefix ID with account to avoid cross-account collisions
                email.server_id = email.id
                email.id = f"a{account.id}_{email.id}"
                buffer.append(email)
                _ingest_progress.total = max(_ingest_progress.total, total)

                if len(buffer) >= BATCH:
                    cache.save_batch(buffer, account_id=account.id)
                    new = rag.ingest_batch(buffer)
                    total_new += new
                    total_skip += len(buffer) - new
                    _ingest_progress.processed = total_new + total_skip
                    buffer = []

            if buffer:
                cache.save_batch(buffer, account_id=account.id)
                new = rag.ingest_batch(buffer)
                total_new += new
                total_skip += len(buffer) - new
                _ingest_progress.processed = total_new + total_skip

        for folder in folders:
            await loop.run_in_executor(None, fetch_folder, folder)

        cache.mark_ingested(account.id)
        return total_new, total_skip

    except Exception as e:
        traceback.print_exc()
        return 0, 0


@router.post("/{account_id}/ingest")
async def ingest_account(account_id: int, background_tasks: BackgroundTasks, request: Request):
    global _ingest_progress
    if _ingest_progress.status == "running":
        raise HTTPException(409, "Ingest already running")

    cache = request.app.state.cache
    account = cache.get_account(account_id)
    if not account:
        raise HTTPException(404, "Account not found")

    rag = request.app.state.rag

    async def run():
        global _ingest_progress
        _ingest_progress = IngestProgress(status="running", message="Starting…")
        new, skip = await _ingest_account(account, rag, cache)
        rag.flush_bm25()
        _ingest_progress = IngestProgress(
            status="completed",
            processed=new + skip,
            total=new + skip,
            message=f"Done — {new} new, {skip} existing",
        )

    background_tasks.add_task(run)
    return {"status": "started", "account_id": account_id}


@router.post("/ingest-all")
async def ingest_all(background_tasks: BackgroundTasks, request: Request):
    global _ingest_progress
    if _ingest_progress.status == "running":
        raise HTTPException(409, "Ingest already running")

    cache = request.app.state.cache
    accounts = cache.list_accounts()
    if not accounts:
        raise HTTPException(400, "No accounts configured")

    rag = request.app.state.rag
    _ingest_progress = IngestProgress(status="running", message="Starting…")

    async def run():
        global _ingest_progress
        total_new = 0
        total_skip = 0
        for acc in accounts:
            new, skip = await _ingest_account(acc, rag, cache)
            total_new += new
            total_skip += skip

        rag.flush_bm25()
        _ingest_progress = IngestProgress(
            status="completed",
            processed=total_new + total_skip,
            total=total_new + total_skip,
            message=f"All accounts done — {total_new} new, {total_skip} existing",
        )

    background_tasks.add_task(run)
    return {"status": "started", "accounts": len(accounts)}


@router.get("/ingest/progress")
async def ingest_progress():
    async def stream():
        while _ingest_progress.status == "running":
            yield f"data: {_ingest_progress.model_dump_json()}\n\n"
            await asyncio.sleep(0.5)
        yield f"data: {_ingest_progress.model_dump_json()}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
