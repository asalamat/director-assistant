"""Backup and restore — export/import the entire database + config."""

import io
import json
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


def _split_json_response(data: dict, filename: str) -> StreamingResponse:
    buf = io.BytesIO(json.dumps(data, indent=2).encode())
    return StreamingResponse(
        buf,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _load_uploaded_json(content: bytes) -> dict:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(400, "File is not valid JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "Invalid config backup format")
    return data


@router.get("/config-export")
async def export_config():
    """Download general app settings only — no API keys or other secrets."""
    from routers.config import load_app_config
    from services.config_secrets import _SENSITIVE_KEYS
    cfg = load_app_config()
    general = {k: v for k, v in cfg.items() if k not in _SENSITIVE_KEYS}
    return _split_json_response(general, "director-assistant-config-backup.json")


@router.post("/config-import")
async def import_config(file: UploadFile = File(...)):
    """Restore general settings only — merges onto existing config, leaves API keys untouched."""
    if not (file.filename or "").lower().endswith(".json"):
        raise HTTPException(400, "File must be a .json config backup")
    data = _load_uploaded_json(await file.read())

    from routers.config import load_app_config, save_app_config
    from services.config_secrets import _SENSITIVE_KEYS
    cfg = load_app_config()
    cfg.update({k: v for k, v in data.items() if k not in _SENSITIVE_KEYS})
    save_app_config(cfg)
    return {"ok": True, "message": "Configuration restored. Restart the app to apply."}


@router.get("/security-export")
async def export_security_config():
    """Download API keys & security-sensitive config only, resolved from the OS keychain
    so the file is actually usable on another machine."""
    from routers.config import load_app_config
    from services.config_secrets import _SENSITIVE_KEYS
    cfg = load_app_config()
    secure = {k: v for k, v in cfg.items() if k in _SENSITIVE_KEYS}
    return _split_json_response(secure, "director-assistant-security-backup.json")


@router.post("/security-import")
async def import_security_config(file: UploadFile = File(...)):
    """Restore API keys & security-sensitive config only — merges onto existing config,
    leaves general settings untouched."""
    if not (file.filename or "").lower().endswith(".json"):
        raise HTTPException(400, "File must be a .json config backup")
    data = _load_uploaded_json(await file.read())

    from routers.config import load_app_config, save_app_config
    from services.config_secrets import _SENSITIVE_KEYS
    cfg = load_app_config()
    cfg.update({k: v for k, v in data.items() if k in _SENSITIVE_KEYS})
    save_app_config(cfg)
    return {"ok": True, "message": "API keys & security config restored. Restart the app to apply."}


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
