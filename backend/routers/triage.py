"""Smart Daily Triage: surfaces top-priority unread emails."""

import asyncio
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/triage", tags=["triage"])


@router.get("/top")
async def get_triage_top(request: Request, limit: int = 7):
    """Return top N priority emails scored by urgency."""
    cache = request.app.state.cache
    loop = asyncio.get_event_loop()
    from services.triage import get_top_emails
    emails = await loop.run_in_executor(None, get_top_emails, cache, min(limit, 20))
    return {"emails": emails}


@router.get("/sorted")
async def priority_sorted(request: Request, folder: str = "INBOX", limit: int = 50):
    """Return all emails in the folder sorted by AI urgency score."""
    import asyncio
    cache = request.app.state.cache
    loop = asyncio.get_event_loop()
    from services.triage import get_top_emails
    scored = await loop.run_in_executor(None, get_top_emails, cache, limit)
    scored_ids = {e["id"] for e in scored}
    summaries, _ = cache.list_emails(folder=folder, skip=0, limit=limit,
                                     sort_by="date", sort_order="desc")
    unscored = [{"id": s.id, "subject": s.subject, "sender": s.sender,
                 "date": s.date, "preview": s.preview, "is_read": s.is_read,
                 "score": 0, "reasons": []}
                for s in summaries if s.id not in scored_ids]
    return {"emails": scored + unscored}
