import asyncio
import os
from pathlib import Path
from typing import List
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from routers.config import load_app_config, save_app_config
from services.document_ingestor import ingest_folder, get_progress

router = APIRouter(prefix="/api/documents", tags=["documents"])


class FoldersConfig(BaseModel):
    folders: List[str]


def _get_folders(cfg: dict) -> List[str]:
    """Read folders list from config, handling legacy single-folder key."""
    folders = cfg.get("document_folders")
    if folders is not None:
        return [f for f in folders if f]
    legacy = cfg.get("document_folder", "")
    return [legacy] if legacy else []


@router.get("/folders")
async def get_folders():
    cfg = load_app_config()
    return {"folders": _get_folders(cfg)}


@router.post("/folders")
async def set_folders(body: FoldersConfig):
    cfg = load_app_config()
    folders = [f.strip() for f in body.folders if f.strip()]
    cfg["document_folders"] = folders
    cfg.pop("document_folder", None)   # remove legacy key
    save_app_config(cfg)
    return {"status": "saved", "folders": folders}


@router.post("/ingest")
async def start_ingest(background_tasks: BackgroundTasks, request: Request):
    cfg = load_app_config()
    folders = _get_folders(cfg)
    if not folders:
        raise HTTPException(400, "No document folders configured")

    prog = get_progress()
    if prog.status == "running":
        raise HTTPException(409, "Document ingest already running")

    rag = request.app.state.rag

    def _run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            for folder in folders:
                ingest_folder(folder, rag)
        finally:
            loop.close()

    background_tasks.add_task(_run)
    return {"status": "started", "folders": folders}


@router.get("/status")
async def ingest_status():
    p = get_progress()
    return {
        "status": p.status,
        "processed": p.processed,
        "total": p.total,
        "message": p.message,
    }


@router.get("/browse")
async def browse_folder(path: str = ""):
    """Return subdirectories at the given path for the folder picker UI."""
    if not path:
        path = str(Path.home())

    target = Path(path).expanduser().resolve()
    if not target.exists() or not target.is_dir():
        # Fall back to home
        target = Path.home()

    try:
        entries = sorted(
            [e for e in target.iterdir() if e.is_dir() and not e.name.startswith(".")],
            key=lambda e: e.name.lower(),
        )
    except PermissionError:
        entries = []

    parent = str(target.parent) if target != target.parent else None

    return {
        "current": str(target),
        "parent": parent,
        "dirs": [{"name": e.name, "path": str(e)} for e in entries],
    }


@router.get("")
async def list_documents(request: Request):
    rag = request.app.state.rag
    docs = rag.list_indexed_docs()
    return {"documents": docs, "total": len(docs)}
