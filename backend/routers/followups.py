from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional

from models import FollowUp

router = APIRouter(prefix="/api/followups", tags=["followups"])


class FollowUpPatch(BaseModel):
    done: bool


@router.get("")
async def list_followups(request: Request, done: Optional[bool] = None):
    cache = request.app.state.cache
    return cache.list_follow_ups(done=done)


@router.post("")
async def create_followup(f: FollowUp, request: Request):
    cache = request.app.state.cache
    fid = cache.add_follow_up(f)
    return {"id": fid}


@router.patch("/{fid}")
async def update_followup(fid: int, patch: FollowUpPatch, request: Request):
    cache = request.app.state.cache
    if not cache.set_follow_up_done(fid, patch.done):
        raise HTTPException(404, "Follow-up not found")
    return {"ok": True}


@router.delete("/{fid}")
async def delete_followup(fid: int, request: Request):
    cache = request.app.state.cache
    if not cache.delete_follow_up(fid):
        raise HTTPException(404, "Follow-up not found")
    return {"ok": True}
