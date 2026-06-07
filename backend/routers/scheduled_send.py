"""Scheduled email send — write now, deliver at a future time."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/scheduled-sends", tags=["scheduled-send"])


class ScheduleBody(BaseModel):
    account_id: int = 0
    to_addr: str
    subject: str
    body: str
    send_at: str  # ISO datetime string e.g. "2026-06-05T09:00:00"


@router.post("")
async def schedule(body: ScheduleBody, request: Request):
    if not body.to_addr or not body.subject:
        raise HTTPException(400, "to_addr and subject required")
    sid = request.app.state.cache.schedule_send(
        body.account_id, body.to_addr, body.subject, body.body, body.send_at
    )
    return {"id": sid, "send_at": body.send_at}


@router.get("")
async def list_pending(request: Request):
    return request.app.state.cache.list_scheduled_sends(sent=False)


@router.delete("/{send_id}")
async def cancel(send_id: int, request: Request):
    with request.app.state.cache._conn() as conn:
        conn.execute("DELETE FROM scheduled_sends WHERE id = ? AND sent = 0", (send_id,))
    return {"ok": True}
