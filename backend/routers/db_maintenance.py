"""Database maintenance — stats, VACUUM/ANALYZE, retention pruning."""
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import APIRouter, Request
from routers.config import load_app_config, save_app_config

router = APIRouter(prefix="/api/db", tags=["db-maintenance"])


def _db_path(request: Request) -> str:
    return request.app.state.cache.db_path


def _db_size_mb(path: str) -> float:
    # DB is WAL mode — sum main file plus -wal/-shm siblings for a true on-disk figure.
    total = sum(
        Path(p).stat().st_size
        for p in (path, path + "-wal", path + "-shm")
        if Path(p).exists()
    )
    return round(total / 1024 / 1024, 2)


@router.get("/stats")
async def db_stats(request: Request):
    path = _db_path(request)
    size_mb = _db_size_mb(path)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        email_count = conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0]
        vip_count = conn.execute("SELECT COUNT(*) FROM vip_contacts").fetchone()[0]
        total_tables = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0]
    finally:
        conn.close()
    cfg = load_app_config()
    return {
        "db_size_mb": size_mb,
        "email_count": email_count,
        "vip_count": vip_count,
        "total_tables": total_tables,
        "last_vacuum": cfg.get("db_last_vacuum"),      # ISO str or None
        "retention_days": cfg.get("db_retention_days", 0),
    }


@router.post("/optimize")
async def db_optimize(request: Request):
    path = _db_path(request)
    start = time.perf_counter()
    conn = sqlite3.connect(path, timeout=60, isolation_level=None)  # autocommit — VACUUM needs it
    try:
        conn.execute("VACUUM")
        conn.execute("ANALYZE")
    finally:
        conn.close()
    duration_ms = int((time.perf_counter() - start) * 1000)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cfg = load_app_config()
    cfg["db_last_vacuum"] = now_iso
    save_app_config(cfg)
    size_mb = _db_size_mb(path)
    return {"status": "optimized", "duration_ms": duration_ms,
            "last_vacuum": now_iso, "db_size_mb": size_mb}


@router.get("/count-before")
async def count_before(date: str, request: Request):
    """Return how many emails exist before a given date (YYYY-MM-DD)."""
    path = _db_path(request)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        count = conn.execute(
            "SELECT COUNT(*) FROM emails WHERE date < ?", (date,)
        ).fetchone()[0]
    finally:
        conn.close()
    return {"count": count, "date": date}


@router.delete("/delete-before")
async def delete_before(date: str, request: Request):
    """Delete all emails (including VIP) with date < date (YYYY-MM-DD)."""
    path = _db_path(request)
    conn = sqlite3.connect(path, timeout=60)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("SELECT id FROM emails WHERE date < ?", (date,)).fetchall()
        ids = [r["id"] for r in rows]
        deleted = 0
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            ph = ",".join("?" * len(chunk))
            conn.execute(f"DELETE FROM emails WHERE id IN ({ph})", chunk)
            deleted += len(chunk)
        conn.commit()
    finally:
        conn.close()
    rag = getattr(request.app.state, "rag", None)
    if rag:
        for eid in ids:
            try:
                rag.remove_email(eid)
            except Exception:
                pass
    return {"status": "deleted", "deleted": deleted, "before": date}


@router.delete("/retention")
async def apply_retention(request: Request):
    cfg = load_app_config()
    days = int(cfg.get("db_retention_days", 0) or 0)
    if days <= 0:
        return {"status": "disabled", "deleted": 0}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    path = _db_path(request)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        # Delete non-VIP emails older than cutoff. cached_at is the reliable local timestamp.
        rows = conn.execute(
            """SELECT id FROM emails
               WHERE cached_at < ?
                 AND lower(sender) NOT IN (SELECT lower(email_addr) FROM vip_contacts)""",
            (cutoff,),
        ).fetchall()
        ids = [r["id"] for r in rows]
        deleted = 0
        # Chunk deletes to respect SQLite's 999-variable limit (known issue in this codebase)
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            ph = ",".join("?" * len(chunk))
            conn.execute(f"DELETE FROM emails WHERE id IN ({ph})", chunk)
            deleted += len(chunk)
        conn.commit()
    finally:
        conn.close()
    # Remove from RAG index too
    rag = getattr(request.app.state, "rag", None)
    if rag:
        for eid in ids:
            try:
                rag.remove_email(eid)
            except Exception:
                pass
    return {"status": "pruned", "deleted": deleted, "cutoff": cutoff}
