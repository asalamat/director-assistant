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
