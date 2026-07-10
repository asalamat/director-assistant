"""Overnight triage — AI-generated pending draft replies."""

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/overnight", tags=["overnight"])


@router.get("/drafts")
async def list_drafts(request: Request):
    """List pending overnight draft replies."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT * FROM overnight_drafts WHERE status='pending' ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
    return {"drafts": [dict(r) for r in rows], "count": len(rows)}


@router.post("/drafts/{draft_id}/approve")
async def approve_draft(draft_id: int, request: Request):
    """Send an approved overnight draft via email."""
    import asyncio
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    cache = request.app.state.cache
    with cache._conn() as conn:
        row = conn.execute("SELECT * FROM overnight_drafts WHERE id=?", (draft_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Draft not found")
    d = dict(row)

    accounts = cache.list_accounts()
    smtp_acc = next((a for a in accounts if getattr(a, "password", None)), None)
    if not smtp_acc:
        raise HTTPException(500, "No SMTP account configured")

    try:
        msg = MIMEMultipart()
        msg["From"] = smtp_acc.username
        msg["To"] = d["draft_to"]
        msg["Subject"] = d["draft_subject"]
        msg.attach(MIMEText(d["draft_body"], "plain"))

        loop = asyncio.get_event_loop()
        from routers.email_send import _smtp_send
        await loop.run_in_executor(None, _smtp_send, smtp_acc, msg)
    except Exception as e:
        raise HTTPException(500, f"Send failed: {e}")

    with cache._conn() as conn:
        conn.execute("UPDATE overnight_drafts SET status='sent' WHERE id=?", (draft_id,))
    return {"status": "sent"}


@router.post("/drafts/{draft_id}/discard")
async def discard_draft(draft_id: int, request: Request):
    """Discard an overnight draft."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("UPDATE overnight_drafts SET status='discarded' WHERE id=?", (draft_id,))
    return {"status": "discarded"}


@router.post("/run-now")
async def run_now(request: Request):
    """Trigger overnight triage immediately (for testing)."""
    import asyncio
    from workers.reports_worker import _run_overnight_triage
    asyncio.create_task(_run_overnight_triage(request.app))
    return {"queued": True}
