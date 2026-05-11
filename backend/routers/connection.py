import json
import asyncio
from pathlib import Path
from typing import Optional, AsyncIterator
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import StreamingResponse

from models import ConnectionConfig, IngestProgress, IngestRequest, Account
from services.email_provider import build_provider

router = APIRouter(prefix="/api/connection", tags=["connection"])

CONFIG_PATH = Path.home() / ".director-assistant" / "config.json"
_progress = IngestProgress()
_provider = None


def load_config() -> Optional[ConnectionConfig]:
    if CONFIG_PATH.exists():
        return ConnectionConfig.model_validate_json(CONFIG_PATH.read_text())
    return None


def get_provider():
    return _provider


@router.post("/connect")
async def connect(config: ConnectionConfig, request: Request):
    """Legacy single-account connect — adds as account in the accounts table."""
    global _provider
    provider = build_provider(config)
    if not provider.test_connection():
        raise HTTPException(400, "Connection failed — check credentials")

    _provider = provider
    cache = request.app.state.cache
    account = Account(
        provider=config.provider,
        username=config.username,
        name=config.username,
        password=config.password,
        imap_host=config.imap_host,
        imap_port=config.imap_port,
        tenant_id=config.tenant_id,
        client_id=config.client_id,
        client_secret=config.client_secret,
    )
    # Don't duplicate if same username already exists
    existing = [a for a in cache.list_accounts() if a.username == config.username]
    if not existing:
        cache.add_account(account)

    # Save legacy config for backwards compat
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(config.model_dump_json())
    return {"status": "connected", "provider": config.provider}


@router.get("/status")
async def status(request: Request):
    global _provider
    cache = request.app.state.cache
    accounts = cache.list_accounts()
    connected = len(accounts) > 0

    # Migrate legacy config.json on first startup
    if not connected and CONFIG_PATH.exists():
        cache.import_legacy_config(CONFIG_PATH.read_text())
        accounts = cache.list_accounts()
        connected = len(accounts) > 0

    return {
        "connected": connected,
        "accounts": len(accounts),
        "provider": accounts[0].provider if accounts else None,
    }


@router.delete("/disconnect")
async def disconnect(request: Request):
    global _provider
    _provider = None
    # Clear all accounts
    cache = request.app.state.cache
    for acc in cache.list_accounts():
        cache.remove_account(acc.id)
    if CONFIG_PATH.exists():
        CONFIG_PATH.unlink()
    return {"status": "disconnected"}


async def _run_ingest(rag, cache, from_date=None, custom_folders=None):
    global _progress, _provider
    import traceback
    from datetime import datetime

    accounts = cache.list_accounts()

    # Fall back to legacy single config if no accounts in DB
    if not accounts:
        cfg = load_config()
        if not cfg:
            _progress = IngestProgress(status="error", message="No accounts configured")
            return
        if _provider is None:
            _provider = build_provider(cfg)

    dt_from = None
    if from_date:
        try:
            dt_from = datetime.fromisoformat(from_date)
        except Exception:
            pass

    _progress = IngestProgress(status="running", message="Starting…", from_date=from_date)

    try:
        loop = asyncio.get_event_loop()
        total_processed = 0
        total_skipped = 0
        IMAP_BATCH = 500

        providers_to_run = []
        if accounts:
            for acc in accounts:
                cfg = acc.to_connection_config()
                prov = build_provider(cfg)
                folders = custom_folders or prov.get_ingest_folders()
                providers_to_run.append((acc, prov, folders))
        else:
            folders = custom_folders or _provider.get_ingest_folders()
            providers_to_run = [(None, _provider, folders)]

        for acc, prov, folders in providers_to_run:
            account_id = acc.id if acc else 0
            prefix = f"[{acc.username}] " if acc else ""

            def fetch_folder(folder: str):
                nonlocal total_processed, total_skipped
                date_label = f" from {from_date}" if from_date else ""
                _progress.message = f"{prefix}{folder}{date_label}…"
                buffer = []
                folder_total = 0

                for email, t in prov.fetch_all(folder=folder, batch_size=100, from_date=dt_from):
                    folder_total = max(folder_total, t)
                    if account_id:
                        email.server_id = email.id
                        email.id = f"a{account_id}_{email.id}"
                    buffer.append(email)

                    if len(buffer) >= IMAP_BATCH:
                        cache.save_batch(buffer, account_id=account_id)
                        new = rag.ingest_batch(buffer)
                        total_processed += new
                        total_skipped += len(buffer) - new
                        buffer = []
                        _progress.total = folder_total
                        _progress.processed = total_processed + total_skipped

                if buffer:
                    cache.save_batch(buffer, account_id=account_id)
                    new = rag.ingest_batch(buffer)
                    total_processed += new
                    total_skipped += len(buffer) - new

            for folder in folders:
                await loop.run_in_executor(None, fetch_folder, folder)

            if acc:
                cache.mark_ingested(acc.id)

        rag.flush_bm25()
        _progress = IngestProgress(
            total=total_processed + total_skipped,
            processed=total_processed + total_skipped,
            status="completed",
            from_date=from_date,
            message=f"Done — {total_processed} new across {sum(len(f) for _, _, f in providers_to_run)} folders"
                    + (f" from {from_date}" if from_date else "")
                    + f" ({total_skipped} already existed)",
        )
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[ingest error]\n{tb}")
        _progress = IngestProgress(status="error", message=str(e))


@router.post("/ingest")
async def start_ingest(req: IngestRequest, background_tasks: BackgroundTasks, request: Request):
    global _progress
    if _progress.status == "running":
        raise HTTPException(409, "Ingestion already running")

    rag = request.app.state.rag
    cache = request.app.state.cache
    _progress = IngestProgress(status="running", message="Starting…", from_date=req.from_date)
    background_tasks.add_task(_run_ingest, rag, cache, req.from_date, req.folders)
    return {"status": "started", "from_date": req.from_date}


@router.get("/ingest/progress")
async def ingest_progress():
    async def event_stream() -> AsyncIterator[str]:
        while _progress.status == "running":
            yield f"data: {_progress.model_dump_json()}\n\n"
            await asyncio.sleep(0.5)
        yield f"data: {_progress.model_dump_json()}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/ingest/status")
async def ingest_status():
    return _progress
