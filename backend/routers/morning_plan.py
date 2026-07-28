"""Morning Game Plan — deterministic start-of-day snapshot.

Distinct from /api/morning-brief (heavier, includes news + AI synthesis).
Assembles top priority emails, open waiting-reply loops, and a quick win.
"""
import datetime
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/intelligence", tags=["morning-plan"])


@router.post("/morning-plan")
async def morning_plan(request: Request):
    cache = request.app.state.cache

    try:
        from routers.morning_brief import _priority_emails
        top_emails = _priority_emails(cache)[:3]
    except Exception:
        top_emails = []

    try:
        from services.waiting_reply import get_waiting_replies
        waiting = get_waiting_replies(cache, 3, 10)
    except Exception:
        waiting = []

    open_loops = [
        {
            "email_id": str(r.get("id", r.get("email_id", ""))),
            "subject": r.get("subject", ""),
            "sender": r.get("sender", r.get("recipient", "")),
            "due_date": r.get("due_date", ""),
        }
        for r in waiting[:5]
    ]

    priority_emails = [
        {
            "id": str(e.get("email_id", e.get("id", ""))),
            "subject": e.get("subject", ""),
            "sender": e.get("sender", ""),
            "date": e.get("date", ""),
            "is_vip": e.get("is_vip", False),
        }
        for e in top_emails
    ]

    return {
        "priority_emails": priority_emails,
        "open_loops": open_loops,
        "quick_win": _build_quick_win(waiting, top_emails),
        "generated_at": datetime.datetime.now().isoformat(),
    }


def _build_quick_win(open_loops: list[dict], top_emails: list[dict]) -> str:
    if open_loops:
        loop = open_loops[0]
        who = loop.get("recipient") or loop.get("sender") or "someone"
        days = loop.get("days_waiting", 0)
        return (
            f"Follow up with {who} on \"{loop.get('subject', '')}\" — "
            f"waiting {days} day(s) with no reply."
        )
    if top_emails:
        em = top_emails[0]
        return f"Start with \"{em.get('subject', '')}\" from {em.get('sender', '')}."
    return "Inbox is calm — no urgent loops or priority emails."
