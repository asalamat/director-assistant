import json
import asyncio
from pathlib import Path
from typing import Optional, AsyncIterator
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import StreamingResponse

from models import ConnectionConfig, IngestProgress, IngestRequest, EmailProviderType
from services.email_provider import build_provider, IMAPProvider, Office365Provider

router = APIRouter(prefix="/api/connection", tags=["connection"])

CONFIG_PATH = Path.home() / ".director-assistant" / "config.json"
_progress = IngestProgress()
_provider = None


def _save_config(config: ConnectionConfig):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(config.model_dump_json())


def load_config() -> Optional[ConnectionConfig]:
    if CONFIG_PATH.exists():
        return ConnectionConfig.model_validate_json(CONFIG_PATH.read_text())
    return None


def get_provider():
    return _provider


@router.post("/connect")
async def connect(config: ConnectionConfig, request: Request):
    global _provider
    provider = build_provider(config)
    if not provider.test_connection():
        raise HTTPException(400, "Connection failed — check credentials")
    _provider = provider
    _save_config(config)
    return {"status": "connected", "provider": config.provider}


@router.get("/status")
async def status():
    global _provider
    cfg = load_config()
    if _provider is None and cfg:
        _provider = build_provider(cfg)
    return {
        "connected": _provider is not None,
        "provider": cfg.provider if cfg else None,
    }


@router.delete("/disconnect")
async def disconnect():
    global _provider
    _provider = None
    if CONFIG_PATH.exists():
        CONFIG_PATH.unlink()
    return {"status": "disconnected"}


async def _run_ingest(rag, cache, from_date=None, custom_folders=None):
    global _progress, _provider
    import traceback
    from datetime import datetime

    if _provider is None:
        cfg = load_config()
        if not cfg:
            _progress = IngestProgress(status="error", message="Not connected — connect first")
            return
        _provider = build_provider(cfg)

    # Parse from_date
    dt_from = None
    if from_date:
        try:
            dt_from = datetime.fromisoformat(from_date)
        except Exception:
            pass

    _progress = IngestProgress(status="running", message="Detecting folders…", from_date=from_date)

    try:
        loop = asyncio.get_event_loop()
        folders = custom_folders or _provider.get_ingest_folders()
        total_processed = 0
        total_skipped = 0
        IMAP_BATCH = 500

        def fetch_folder(folder: str):
            nonlocal total_processed, total_skipped
            date_label = f" from {from_date}" if from_date else ""
            _progress.message = f"Scanning {folder}{date_label}…"
            known_ids = rag._known_ids()

            buffer: list = []
            folder_total = 0

            for email, t in _provider.fetch_all(folder=folder, batch_size=100, from_date=dt_from):
                folder_total = max(folder_total, t)
                buffer.append(email)

                if len(buffer) >= IMAP_BATCH:
                    cache.save_batch(buffer)
                    new = rag.ingest_batch(buffer, known_ids)
                    total_processed += new
                    total_skipped += len(buffer) - new
                    buffer = []
                    _progress.total = folder_total
                    _progress.processed = total_processed + total_skipped
                    _progress.message = (
                        f"{folder}{date_label}: {total_processed} new, {total_skipped} existing "
                        f"({total_processed + total_skipped}/{folder_total})"
                    )

            if buffer:
                cache.save_batch(buffer)
                new = rag.ingest_batch(buffer, known_ids)
                total_processed += new
                total_skipped += len(buffer) - new

        for folder in folders:
            await loop.run_in_executor(None, fetch_folder, folder)

        rag.flush_bm25()
        _progress = IngestProgress(
            total=total_processed + total_skipped,
            processed=total_processed + total_skipped,
            status="completed",
            from_date=from_date,
            message=(
                f"Done — {total_processed} new emails indexed across "
                f"{', '.join(folders)}"
                + (f" from {from_date}" if from_date else "")
                + f" ({total_skipped} already existed)"
            ),
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

    if _provider is None:
        cfg = load_config()
        if not cfg:
            raise HTTPException(400, "Not connected — go to Settings and connect first")
        try:
            p = build_provider(cfg)
            p.test_connection()
        except Exception as e:
            raise HTTPException(400, f"Cannot reach mailbox: {e}")

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
