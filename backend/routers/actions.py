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


@router.post("/detect-from-sent")
async def detect_commitments_from_sent(request: Request):
    """Scan recent sent emails for commitments and return them as suggested action items."""
    import json as _json
    from services.email_cache import EmailCache
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor

    # Get last 20 sent emails not yet processed
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, date, body
               FROM emails WHERE LOWER(folder) LIKE '%sent%'
               AND date >= datetime('now', '-14 days')
               ORDER BY date DESC LIMIT 20"""
        ).fetchall()
        # Get existing action item email_ids to avoid duplicates
        existing = {r[0] for r in conn.execute(
            "SELECT DISTINCT email_id FROM action_items"
        ).fetchall()}

    new_emails = [dict(r) for r in rows if r["id"] not in existing]
    if not new_emails:
        return {"detected": [], "scanned": 0}

    detected = []
    for em in new_emails[:10]:  # cap at 10 per call
        body = (em.get("body") or "")[:600]
        if not body.strip():
            continue
        prompt = (
            f"This is an email YOU sent. Extract any commitments you made.\n"
            f"Subject: {em.get('subject','')}\n{body}\n\n"
            "List ONLY concrete commitments/promises (e.g. 'Send report by Friday', 'Schedule call next week').\n"
            'Return JSON: {"commitments": ["item1", "item2"]} or {"commitments": []} if none.'
        )
        ant = getattr(advisor.ai, "_anthropic", None)
        try:
            if ant:
                resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=200,
                    messages=[{"role": "user", "content": prompt}])
                text = resp.content[0].text.strip()
            else:
                resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=200,
                    messages=[{"role": "user", "content": prompt}])
                text = resp.content[0].text.strip()
            start, end = text.find("{"), text.rfind("}") + 1
            data = _json.loads(text[start:end]) if start >= 0 else {}
            commitments = data.get("commitments", [])
            if commitments:
                detected.append({
                    "email_id": em["id"],
                    "subject": em.get("subject") or "(no subject)",
                    "date": (em.get("date") or "")[:10],
                    "commitments": commitments,
                })
        except Exception:
            continue

    return {"detected": detected, "scanned": len(new_emails)}


@router.post("/detect-from-inbox")
async def detect_asks_from_inbox(request: Request):
    """Scan recent received emails for asks/requests directed at the user."""
    import json as _json
    from services.email_cache import EmailCache
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor

    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, date, body
               FROM emails
               WHERE (LOWER(folder) LIKE '%inbox%' OR LOWER(folder) LIKE '%gmail%')
               AND LOWER(folder) NOT LIKE '%sent%'
               AND date >= datetime('now', '-14 days')
               ORDER BY date DESC LIMIT 20"""
        ).fetchall()
        existing = {r[0] for r in conn.execute(
            "SELECT DISTINCT email_id FROM action_items"
        ).fetchall()}

    new_emails = [dict(r) for r in rows if r["id"] not in existing]
    if not new_emails:
        return {"detected": [], "scanned": 0}

    detected = []
    for em in new_emails[:10]:
        body = (em.get("body") or "")[:600]
        if not body.strip():
            continue
        prompt = (
            "This is an email someone sent TO you. Extract any asks, requests, or to-dos they are directing at you.\n"
            f"Subject: {em.get('subject','')}\n"
            f"From: {em.get('sender','')}\n"
            f"{body}\n\n"
            'List ONLY concrete requests/asks made of you (e.g. "Review the proposal", "Send your availability", "Confirm the meeting").\n'
            'Return JSON: {"asks": ["item1", "item2"]} or {"asks": []} if none.'
        )
        ant = getattr(advisor.ai, "_anthropic", None)
        try:
            if ant:
                resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=200,
                    messages=[{"role": "user", "content": prompt}])
                text = resp.content[0].text.strip()
            else:
                resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=200,
                    messages=[{"role": "user", "content": prompt}])
                text = resp.content[0].text.strip()
            start, end = text.find("{"), text.rfind("}") + 1
            data = _json.loads(text[start:end]) if start >= 0 else {}
            asks = data.get("asks", [])
            if asks:
                detected.append({
                    "email_id": em["id"],
                    "subject": em.get("subject") or "(no subject)",
                    "date": (em.get("date") or "")[:10],
                    "sender": em.get("sender") or "",
                    "asks": asks,
                })
        except Exception:
            continue

    return {"detected": detected, "scanned": len(new_emails)}


@router.post("/{item_id}/draft-reply")
async def draft_reply_from_action(item_id: int, request: Request):
    """Generate a reply draft addressing this action item."""
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    # Look up the action item
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT id, email_id, email_subject, text FROM action_items WHERE id = ?",
            (item_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Action item not found")

    item = dict(row)
    # Get source email
    with cache._conn() as conn:
        em = conn.execute(
            "SELECT subject, sender, body FROM emails WHERE id = ?",
            (item["email_id"],)
        ).fetchone()
    em = dict(em) if em else {}

    subject = em.get("subject") or item.get("email_subject") or ""
    sender = em.get("sender") or ""
    body_snippet = (em.get("body") or "")[:600]

    prompt = (
        f"Write a short professional email reply that addresses this action item:\n"
        f"Action: {item['text']}\n\n"
        f"Original email subject: {subject}\n"
        f"From: {sender}\n"
        f"Original message snippet:\n{body_snippet}\n\n"
        "Write ONLY the reply body (no subject line, no greeting header). "
        "Be concise and professional. 2-4 sentences max."
    )
    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}])
            body = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}])
            body = resp.content[0].text.strip()
    except Exception as e:
        raise HTTPException(500, f"AI draft failed: {e}")

    # Extract reply-to address
    import re as _re
    to = _re.search(r"<([^>]+)>", sender)
    to = to.group(1) if to else sender

    return {
        "to": to,
        "subject": f"Re: {subject}" if subject and not subject.lower().startswith("re:") else subject,
        "body": body,
    }


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
