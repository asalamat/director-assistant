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


@router.get("/waiting")
async def get_waiting_replies(request: Request, days: int = 3, limit: int = 20):
    """Return sent emails older than `days` with no detected reply."""
    import asyncio
    from services.waiting_reply import get_waiting_replies as _get
    cache = request.app.state.cache
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _get, cache, days, min(limit, 50))
    return {"emails": result, "threshold_days": days}


@router.post("/chase-draft/{email_id}")
async def generate_chase_draft(email_id: str, request: Request):
    """Generate an AI follow-up draft for an email that hasn't been replied to."""
    import json as _json
    cache = request.app.state.cache
    advisor = request.app.state.advisor
    email = cache.get(email_id)
    if not email:
        from fastapi import HTTPException
        raise HTTPException(404, "Email not found")

    prompt = (
        f"Write a short, polite follow-up email to check in on the status of this conversation.\n\n"
        f"Original email:\nFrom: {email.sender}\nSubject: {email.subject}\n"
        f"Date: {email.date}\n\n{(email.body or '')[:600]}\n\n"
        "Write ONLY the follow-up email body — no subject line, no preamble. "
        "Keep it under 4 sentences. Be polite and professional."
    )
    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}])
            draft = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}])
            draft = resp.content[0].text.strip()
    except Exception as ex:
        draft = f"Hi,\n\nJust following up on my previous email regarding {email.subject}. Please let me know if you have any updates.\n\nThank you."

    subject = email.subject or ""
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"
    return {"draft": draft, "subject": subject, "to": email.sender, "email_id": email_id}
