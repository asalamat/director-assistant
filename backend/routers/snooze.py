import re
from datetime import datetime

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/snooze", tags=["snooze"])

_EMAIL_ID_RE = re.compile(r"^[a-zA-Z0-9_@.:/-]+$")


def _ensure_schema(cache) -> None:
    """Idempotent migration for older DBs.

    Older versions created email_snooze with `wake_date TEXT NOT NULL` and no
    `set_aside` column. Set-aside rows store a NULL wake_date, so the NOT NULL
    constraint must be relaxed by rebuilding the table when present.
    """
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='email_snooze'"
        ).fetchone()
        ddl = (row["sql"] if row else "") or ""
        if "NOT NULL" in ddl:
            conn.executescript(
                """
                ALTER TABLE email_snooze RENAME TO email_snooze_old;
                CREATE TABLE email_snooze (
                    email_id   TEXT PRIMARY KEY,
                    wake_date  TEXT,
                    set_aside  INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                INSERT INTO email_snooze (email_id, wake_date, created_at)
                    SELECT email_id, wake_date, created_at FROM email_snooze_old;
                DROP TABLE email_snooze_old;
                """
            )
            return
        try:
            conn.execute("ALTER TABLE email_snooze ADD COLUMN set_aside INTEGER DEFAULT 0")
        except Exception:
            pass  # column already exists


def _validate_email_id(email_id: str) -> str:
    if not email_id or not _EMAIL_ID_RE.match(email_id):
        raise HTTPException(400, "Invalid email_id")
    return email_id


def _validate_wake_date(wake_date: str | None) -> str | None:
    if wake_date is None:
        return None
    wake_date = wake_date.strip()
    if not wake_date:
        return None
    try:
        # Accept ISO date (YYYY-MM-DD) or full ISO datetime
        datetime.fromisoformat(wake_date)
    except ValueError:
        raise HTTPException(400, "Invalid wake_date — expected ISO format (YYYY-MM-DD)")
    return wake_date


class SnoozeRequest(BaseModel):
    wake_date: str | None = None
    set_aside: bool = False


@router.get("")
async def list_snoozed(request: Request):
    cache = request.app.state.cache
    return {"snoozed": cache.list_snoozed()}


@router.get("/set-aside")
async def list_set_aside(request: Request):
    cache = request.app.state.cache
    return {"emails": cache.list_set_aside()}


@router.post("/wake-due")
async def wake_due(request: Request):
    cache = request.app.state.cache
    woken = cache.wake_due_snoozed()
    return {"woken": woken}


@router.post("/{email_id}")
async def snooze_email(email_id: str, req: SnoozeRequest, request: Request):
    _validate_email_id(email_id)
    if not req.set_aside and not req.wake_date:
        raise HTTPException(400, "wake_date required unless set_aside is true")
    wake_date = None if req.set_aside else _validate_wake_date(req.wake_date)
    cache = request.app.state.cache
    cache.snooze_email(email_id, wake_date=wake_date, set_aside=req.set_aside)
    return {"ok": True}


@router.delete("/{email_id}")
async def unsnooze_email(email_id: str, request: Request):
    _validate_email_id(email_id)
    cache = request.app.state.cache
    cache.unsnooze_email(email_id)
    return {"ok": True}
