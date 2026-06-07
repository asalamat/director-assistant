"""PST file import — upload and ingest Outlook .pst archives."""
import asyncio
import os
import tempfile
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
import json

router = APIRouter(prefix="/api/pst", tags=["pst"])

# In-memory import state (keyed by task_id)
_imports: dict[str, dict] = {}


@router.get("/status")
async def check_availability():
    """Check whether a PST/OLM parser is available on this system."""
    result = {
        "olm_available": True,   # OLM uses stdlib only — always available
        "olm_backend": "built-in (zipfile + xml)",
    }
    try:
        from services.pst_parser import _detect_backend
        backend = _detect_backend()
        result.update({"pst_available": True, "pst_backend": backend, "available": True})
    except ImportError as e:
        result.update({"pst_available": False, "pst_error": str(e), "available": True})
    return result


@router.post("/import")
async def import_pst(request: Request, file: UploadFile = File(...)):
    """
    Upload a .pst file and import all its emails into the local cache + RAG index.
    Returns a task_id; poll /api/pst/progress/{task_id} for streaming progress.
    """
    fname = (file.filename or "").lower()
    if not (fname.endswith(".pst") or fname.endswith(".olm")):
        raise HTTPException(400, "File must be a .pst or .olm file")

    # Check backend availability first
    is_olm = fname.endswith(".olm")
    try:
        from services.pst_parser import _detect_backend, import_pst as _do_import
        if not is_olm:
            _detect_backend()  # OLM needs no external dep
    except ImportError as e:
        raise HTTPException(422, f"PST parser not available: {e}")

    cache = request.app.state.cache
    rag   = request.app.state.rag

    # Save uploaded file to a temp location
    suffix = ".pst"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        pst_path = tmp.name

    task_id = os.urandom(8).hex()
    _imports[task_id] = {
        "status": "running",
        "processed": 0,
        "current": "",
        "imported": 0,
        "skipped": 0,
        "backend": "",
        "error": None,
        "filename": file.filename,
        "size_mb": round(len(content) / 1_048_576, 1),
    }

    def _progress(processed, total, subject):
        _imports[task_id]["processed"] = processed
        _imports[task_id]["imported"]  = processed
        _imports[task_id]["current"]   = (subject or "")[:60]

    async def _run():
        try:
            result = await _do_import(pst_path, cache, rag, progress_cb=_progress)
            _imports[task_id].update({
                "status":   "done",
                "imported": result["imported"],
                "skipped":  result["skipped"],
                "backend":  result["backend"],
                "current":  "",
            })
        except Exception as e:
            _imports[task_id].update({"status": "error", "error": str(e)})
        finally:
            try:
                os.unlink(pst_path)
            except Exception:
                pass

    asyncio.create_task(_run())
    return {"task_id": task_id, "filename": file.filename}


@router.get("/progress/{task_id}")
async def stream_progress(task_id: str):
    """Server-Sent Events stream of import progress."""
    if task_id not in _imports:
        raise HTTPException(404, "Task not found")

    async def _generate():
        while True:
            state = _imports.get(task_id, {})
            yield f"data: {json.dumps(state)}\n\n"
            if state.get("status") in ("done", "error"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(_generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/tasks")
async def list_tasks():
    """Return all past import tasks."""
    return {"tasks": list(_imports.values())}
