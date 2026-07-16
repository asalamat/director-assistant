"""Smart Daily Triage: surfaces top-priority unread emails."""

import asyncio
import json
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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


class TriageFeedbackRequest(BaseModel):
    email_id: str
    sender: str = ""
    subject: str = ""
    ai_score: int = 0
    user_action: str  # 'keep' | 'dismiss' | 'boost'


@router.post("/feedback")
async def submit_feedback(req: TriageFeedbackRequest, request: Request):
    """Record a user's triage action so scoring can learn over time."""
    if req.user_action not in ("keep", "dismiss", "boost"):
        raise HTTPException(400, "user_action must be keep, dismiss, or boost")
    if not req.email_id.strip():
        raise HTTPException(400, "email_id is required")

    cache = request.app.state.cache
    from services.triage import ensure_feedback_table
    with cache._conn() as conn:
        ensure_feedback_table(conn)
        conn.execute(
            "INSERT INTO triage_feedback (email_id, sender, subject, ai_score, user_action) "
            "VALUES (?, ?, ?, ?, ?)",
            (req.email_id.strip(), req.sender[:500], req.subject[:500],
             req.ai_score, req.user_action),
        )
    return {"ok": True}


@router.get("/learned-patterns")
async def learned_patterns(request: Request):
    """Return sender domains and keywords the triage engine has learned."""
    cache = request.app.state.cache
    loop = asyncio.get_event_loop()
    from services.triage import get_learned_patterns
    return await loop.run_in_executor(None, get_learned_patterns, cache)


@router.delete("/feedback")
async def reset_feedback(request: Request):
    """Delete all triage feedback, resetting learned patterns."""
    cache = request.app.state.cache
    from services.triage import ensure_feedback_table
    with cache._conn() as conn:
        ensure_feedback_table(conn)
        conn.execute("DELETE FROM triage_feedback")
    return {"ok": True}


class SprintRequest(BaseModel):
    limit: int = 60


_SPRINT_BUCKETS = ("reply_now", "needs_thought", "fyi_archive", "delegate")


@router.post("/sprint")
async def sprint(req: SprintRequest, request: Request):
    """Bucket unread emails into 4 action groups using AI for Inbox Zero Sprint."""
    cache = request.app.state.cache
    advisor = getattr(request.app.state, "advisor", None)

    empty = {b: [] for b in _SPRINT_BUCKETS}
    if not advisor:
        raise HTTPException(503, "AI service not available")

    limit = max(1, min(req.limit, 200))
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT id, sender, subject, body, date FROM emails "
            "WHERE is_read = 0 ORDER BY date DESC LIMIT ?",
            (limit,),
        ).fetchall()

    if not rows:
        return {"buckets": empty, "total": 0}

    snippets = "\n".join(
        f"{i}: FROM {r['sender']} | {r['subject']} | {(r['body'] or '')[:150]}"
        for i, r in enumerate(rows)
    )

    prompt = f"""Categorize each email below into exactly one bucket:
- reply_now: needs a direct reply, quick answer, or acknowledgement (< 2 min)
- needs_thought: requires research, a considered response, or has a decision
- fyi_archive: newsletters, notifications, FYI threads, no action needed
- delegate: should be handled by someone else

Return a JSON object with keys reply_now, needs_thought, fyi_archive, delegate.
Each value is an array of 0-based indices (integers) from the list below.
Return ONLY the JSON, no markdown.

{snippets}"""

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1200,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1200,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(500, str(exc))

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise HTTPException(502, "AI returned unparseable response")
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            raise HTTPException(502, "AI returned unparseable response")

    buckets = {b: [] for b in _SPRINT_BUCKETS}
    for b in _SPRINT_BUCKETS:
        for idx in parsed.get(b, []):
            if isinstance(idx, int) and 0 <= idx < len(rows):
                r = rows[idx]
                buckets[b].append({
                    "id": r["id"], "sender": r["sender"],
                    "subject": r["subject"], "date": r["date"],
                })

    return {"buckets": buckets, "total": len(rows)}
