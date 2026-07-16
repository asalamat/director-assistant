"""Read-receipt tracking — 1x1 pixel endpoint plus sent-email open status."""

import base64
import binascii

from fastapi import APIRouter, Request
from fastapi.responses import Response

router = APIRouter(prefix="/api", tags=["tracking"])

# 1x1 transparent PNG
_PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _ensure_tracking_table(cache) -> None:
    with cache._conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sent_tracking (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                email_message_id  TEXT NOT NULL,
                recipient         TEXT NOT NULL,
                opened_at         TEXT DEFAULT NULL,
                open_count        INTEGER DEFAULT 0,
                created_at        TEXT DEFAULT (datetime('now')),
                UNIQUE(email_message_id, recipient)
            )
        """)


def make_token(message_id: str, recipient: str) -> str:
    """URL-safe base64 token encoding `{message_id}:{recipient}`."""
    raw = f"{message_id}:{recipient}".encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def register_send(cache, message_id: str, recipient: str) -> None:
    """Record a tracked outbound email so opens can be attributed."""
    if not message_id or not recipient:
        return
    _ensure_tracking_table(cache)
    with cache._conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO sent_tracking (email_message_id, recipient) VALUES (?,?)",
            (message_id, recipient),
        )


def _decode_token(token: str) -> tuple[str, str] | None:
    try:
        pad = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + pad).decode("utf-8")
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    if ":" not in raw:
        return None
    message_id, _, recipient = raw.partition(":")
    if not message_id or not recipient:
        return None
    return message_id, recipient


@router.get("/track/{token}")
async def track_open(token: str, request: Request):
    """Return a 1x1 transparent PNG and record the email open."""
    cache = getattr(request.app.state, "cache", None)
    decoded = _decode_token(token) if cache else None
    if decoded:
        message_id, recipient = decoded
        try:
            _ensure_tracking_table(cache)
            with cache._conn() as conn:
                conn.execute(
                    "UPDATE sent_tracking SET open_count = open_count + 1, "
                    "opened_at = datetime('now') "
                    "WHERE email_message_id = ? AND recipient = ?",
                    (message_id, recipient),
                )
        except Exception:
            pass
    return Response(
        content=_PIXEL,
        media_type="image/png",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@router.get("/emails/sent/receipts")
async def sent_receipts(request: Request):
    """List tracked sent emails with their open status."""
    cache = request.app.state.cache
    _ensure_tracking_table(cache)
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT email_message_id, recipient, opened_at, open_count "
            "FROM sent_tracking ORDER BY created_at DESC LIMIT 500"
        ).fetchall()
    return {
        "receipts": [
            {
                "message_id": r["email_message_id"],
                "recipient": r["recipient"],
                "opened_at": r["opened_at"] or "",
                "open_count": r["open_count"] or 0,
            }
            for r in rows
        ]
    }
