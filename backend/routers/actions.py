import csv
import io
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List

from models import ActionItem

router = APIRouter(prefix="/api/actions", tags=["actions"])


class ActionPatch(BaseModel):
    done: bool


class BulkActionRequest(BaseModel):
    email_id: str
    email_subject: str = ""
    items: List[str]


@router.get("")
async def list_actions(request: Request, done: Optional[bool] = None):
    cache = request.app.state.cache
    return cache.list_action_items(done=done)


@router.post("/bulk")
async def save_bulk_actions(req: BulkActionRequest, request: Request):
    cache = request.app.state.cache
    count = cache.add_action_items(req.email_id, req.email_subject, req.items)
    return {"saved": count}


@router.patch("/{item_id}")
async def update_action(item_id: int, patch: ActionPatch, request: Request):
    cache = request.app.state.cache
    if not cache.set_action_done(item_id, patch.done):
        raise HTTPException(404, "Action item not found")
    return {"ok": True}


@router.get("/export.csv")
async def export_actions_csv(request: Request):
    items = request.app.state.cache.list_action_items()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "text", "email_subject", "done", "created_at"])
    for a in items:
        w.writerow([a.id, a.text, a.email_subject, "yes" if a.done else "no", a.created_at])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=action_items.csv"},
    )
