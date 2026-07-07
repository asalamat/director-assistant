"""Backup and restore — export/import the entire database + config."""

import io
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/backup", tags=["backup"])

_DB_PATH = Path.home() / ".director-assistant" / "emails.db"
_CONFIG_PATH = Path.home() / ".director-assistant" / "app-config.json"
_CHROMA_DIR = Path.home() / ".director-assistant" / "chroma"


@router.get("/export")
async def export_backup(request: Request):
    """Download a zip containing emails.db and app-config.json."""
    if not _DB_PATH.exists():
        raise HTTPException(404, "Database not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(_DB_PATH, "emails.db")
        if _CONFIG_PATH.exists():
            zf.write(_CONFIG_PATH, "app-config.json")
        if _CHROMA_DIR.exists():
            for p in _CHROMA_DIR.rglob("*"):
                if p.is_file() and p.stat().st_size < 50_000_000:  # skip huge files
                    zf.write(p, f"chroma/{p.relative_to(_CHROMA_DIR)}")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=director-assistant-backup.zip"},
    )


@router.post("/import")
async def import_backup(request: Request, file: UploadFile = File(...)):
    """Restore from a backup zip. Replaces current DB and config. App restart recommended."""
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(400, "File must be a .zip backup")

    content = await file.read()

    # Validate zip before replacing anything
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = zf.namelist()
            if "emails.db" not in names:
                raise HTTPException(400, "Invalid backup: missing emails.db")

            # Validate all entries before extracting (prevent Zip Slip)
            chroma_root = _CHROMA_DIR.resolve()
            for entry in names:
                if entry.startswith("chroma/"):
                    candidate = (chroma_root / entry[len("chroma/"):]).resolve()
                    if not str(candidate).startswith(str(chroma_root) + "/") and candidate != chroma_root:
                        raise HTTPException(400, f"Invalid backup: unsafe path {entry!r}")
                elif entry not in ("emails.db", "app-config.json"):
                    raise HTTPException(400, f"Invalid backup: unexpected entry {entry!r}")

            # Extract everything while the ZipFile is open (entries already validated)
            tmp_dir = Path(tempfile.mkdtemp())
            for entry in ("emails.db", "app-config.json"):
                if entry in names:
                    (tmp_dir / entry).write_bytes(zf.read(entry))

            # Extract chroma entries here while zf is still open
            chroma_entries: list[tuple[str, bytes]] = []
            for name in names:
                if name.startswith("chroma/"):
                    chroma_entries.append((name, zf.read(name)))

        # Swap in the new files
        db_backup = _DB_PATH.with_suffix(".db.bak")
        if _DB_PATH.exists():
            shutil.copy2(_DB_PATH, db_backup)

        shutil.copy2(tmp_dir / "emails.db", _DB_PATH)
        cfg_src = tmp_dir / "app-config.json"
        if cfg_src.exists():
            shutil.copy2(cfg_src, _CONFIG_PATH)

        if chroma_entries:
            _CHROMA_DIR.mkdir(parents=True, exist_ok=True)
            for name, data in chroma_entries:
                # Path validated above — no traversal possible
                target = (_CHROMA_DIR / name[len("chroma/"):]).resolve()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)

        shutil.rmtree(tmp_dir, ignore_errors=True)

    except HTTPException:
        raise
    except zipfile.BadZipFile:
        raise HTTPException(400, "File is not a valid zip")
    except Exception as e:
        raise HTTPException(500, f"Restore failed: {e}")

    return {
        "ok": True,
        "message": "Backup restored. Restart the app to load the new database.",
    }


@router.get("/stats")
async def backup_stats(request: Request):
    """Return DB size, ChromaDB size and last modified time for the backup UI."""
    if not _DB_PATH.exists():
        return {"db_size_mb": 0, "chroma_size_mb": 0, "last_modified": None}
    stat = _DB_PATH.stat()
    chroma_size = sum(p.stat().st_size for p in _CHROMA_DIR.rglob("*") if p.is_file()) if _CHROMA_DIR.exists() else 0
    return {
        "db_size_mb": round(stat.st_size / 1_048_576, 1),
        "chroma_size_mb": round(chroma_size / 1_048_576, 1),
        "last_modified": stat.st_mtime,
    }
