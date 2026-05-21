from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/snooze", tags=["snooze"])


class SnoozeRequest(BaseModel):
    wake_date: str  # ISO date e.g. "2024-05-25"


@router.post("/{email_id}")
async def snooze_email(email_id: str, req: SnoozeRequest, request: Request):
    cache = request.app.state.cache
    cache.snooze_email(email_id, req.wake_date)
    return {"ok": True}


@router.delete("/{email_id}")
async def unsnooze_email(email_id: str, request: Request):
    cache = request.app.state.cache
    cache.unsnooze_email(email_id)
    return {"ok": True}
