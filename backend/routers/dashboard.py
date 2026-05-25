"""
Dashboard generator: pulls real data from existing services and writes
output/dashboard.html — a self-contained, zero-dependency executive brief.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.requests import Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from services.dashboard_renderer import render_dashboard

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_OUTPUT = Path(__file__).resolve().parents[2] / "output" / "dashboard.html"


# ── Data helpers ──────────────────────────────────────────────────────────────

def _db_conn(cache) -> sqlite3.Connection:
    conn = sqlite3.connect(cache.db_path, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _unread_emails(cache, limit: int = 10) -> list[dict]:
    with _db_conn(cache) as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, date, body
               FROM emails WHERE is_read = 0
               ORDER BY date DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def _unread_count(cache) -> int:
    with _db_conn(cache) as conn:
        return conn.execute("SELECT COUNT(*) FROM emails WHERE is_read = 0").fetchone()[0]


def _action_items(cache) -> list[dict]:
    with _db_conn(cache) as conn:
        rows = conn.execute(
            "SELECT * FROM action_items WHERE done = 0 ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def _follow_ups(cache) -> list[dict]:
    with _db_conn(cache) as conn:
        rows = conn.execute(
            "SELECT * FROM follow_ups WHERE done = 0 ORDER BY due_date ASC"
        ).fetchall()
    return [dict(r) for r in rows]


def _top_senders(cache, limit: int = 10) -> list[dict]:
    with _db_conn(cache) as conn:
        rows = conn.execute(
            """SELECT sender, COUNT(*) AS cnt
               FROM emails WHERE sender != ''
               GROUP BY sender ORDER BY cnt DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [{"sender": r["sender"], "count": r["cnt"]} for r in rows]


def _emails_by_day(cache, days: int = 7) -> list[dict]:
    with _db_conn(cache) as conn:
        rows = conn.execute(
            """SELECT substr(date,1,10) AS day, COUNT(*) AS cnt
               FROM emails
               WHERE date >= date('now', ? || ' days')
               GROUP BY day ORDER BY day""",
            (f"-{days}",),
        ).fetchall()
    return [{"date": r["day"], "count": r["cnt"]} for r in rows]


def _training_emails(cache, limit: int = 8) -> list[dict]:
    keywords = ["training", "course", "learning", "certification", "workshop",
                "webinar", "skill", "academy", "e-learning", "onboarding"]
    like_clauses = " OR ".join(["LOWER(subject) LIKE ?" for _ in keywords])
    params = [f"%{k}%" for k in keywords] + [limit]
    with _db_conn(cache) as conn:
        rows = conn.execute(
            f"""SELECT id, subject, sender, date FROM emails
                WHERE ({like_clauses}) ORDER BY date DESC LIMIT ?""",
            params,
        ).fetchall()
    return [dict(r) for r in rows]


def _calendar_events(cache) -> list[dict]:
    """Try to fetch tomorrow's calendar events via Microsoft Graph API."""
    try:
        accounts = cache.list_accounts()
        o365_acc = next(
            (a for a in accounts if getattr(a, "access_token", None) or
             getattr(a, "provider", "") == "office365"), None
        )
        if not o365_acc:
            return []

        import httpx
        token = getattr(o365_acc, "access_token", None)
        if not token:
            return []

        tomorrow = (date.today() + timedelta(days=1))
        start = f"{tomorrow.isoformat()}T00:00:00Z"
        end   = f"{tomorrow.isoformat()}T23:59:59Z"
        url = (
            "https://graph.microsoft.com/v1.0/me/calendarView"
            f"?startDateTime={start}&endDateTime={end}"
            "&$select=subject,start,end,organizer,responseStatus,isOnlineMeeting,attendees"
            "&$orderby=start/dateTime&$top=20"
        )
        resp = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=6)
        if resp.status_code != 200:
            return []
        return resp.json().get("value", [])
    except Exception:
        return []


def _week_calendar(cache) -> list[dict]:
    """Try to fetch this week's calendar for load chart."""
    try:
        accounts = cache.list_accounts()
        o365_acc = next(
            (a for a in accounts if getattr(a, "access_token", None)), None
        )
        if not o365_acc:
            return []
        import httpx
        token = getattr(o365_acc, "access_token", None)
        if not token:
            return []
        today = date.today()
        start = f"{today.isoformat()}T00:00:00Z"
        end   = f"{(today + timedelta(days=7)).isoformat()}T23:59:59Z"
        url = (
            "https://graph.microsoft.com/v1.0/me/calendarView"
            f"?startDateTime={start}&endDateTime={end}"
            "&$select=subject,start,end,categories&$top=50"
        )
        resp = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=6)
        if resp.status_code != 200:
            return []
        return resp.json().get("value", [])
    except Exception:
        return []


def _onedrive_recent(cache) -> list[dict]:
    """Fetch recently modified OneDrive files via Graph API (requires Files.Read scope)."""
    try:
        accounts = cache.list_accounts()
        acc = next((a for a in accounts if getattr(a, "access_token", None)), None)
        if not acc:
            return []
        import httpx
        token = getattr(acc, "access_token", None)
        if not token:
            return []
        resp = httpx.get(
            "https://graph.microsoft.com/v1.0/me/drive/recent"
            "?$select=name,webUrl,lastModifiedDateTime,size&$top=10",
            headers={"Authorization": f"Bearer {token}"}, timeout=6,
        )
        return resp.json().get("value", []) if resp.status_code == 200 else []
    except Exception:
        return []


def _teams_chats(cache) -> list[dict]:
    """Fetch recent Teams chats via Graph API (requires Chat.Read scope)."""
    try:
        accounts = cache.list_accounts()
        acc = next((a for a in accounts if getattr(a, "access_token", None)), None)
        if not acc:
            return []
        import httpx
        token = getattr(acc, "access_token", None)
        if not token:
            return []
        resp = httpx.get(
            "https://graph.microsoft.com/v1.0/me/chats"
            "?$expand=lastMessagePreview&$select=id,topic,chatType,lastMessagePreview&$top=10",
            headers={"Authorization": f"Bearer {token}"}, timeout=6,
        )
        return resp.json().get("value", []) if resp.status_code == 200 else []
    except Exception:
        return []


def _projects_from_intelligence(intelligence) -> list[dict]:
    try:
        people = intelligence.get_people(limit=30)
        subjects: dict[str, int] = {}
        for p in people:
            for s in (p.get("subjects") or [])[:5]:
                key = s.strip()
                if len(key) > 8:
                    subjects[key] = subjects.get(key, 0) + 1
        top = sorted(subjects.items(), key=lambda x: -x[1])[:8]
        return [{"name": k, "count": v, "next": "Review status"} for k, v in top]
    except Exception:
        return []


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("", response_class=HTMLResponse)
async def get_dashboard(request: Request):
    cache = request.app.state.cache
    intelligence = request.app.state.intelligence

    data: dict[str, Any] = {
        "generated_at":   datetime.now().strftime("%A, %d %B %Y  %H:%M"),
        "unread_count":   _unread_count(cache),
        "unread_emails":  _unread_emails(cache),
        "actions":        _action_items(cache),
        "follow_ups":     _follow_ups(cache),
        "top_senders":    _top_senders(cache),
        "email_volume":   _emails_by_day(cache),
        "training":       _training_emails(cache),
        "calendar_today": _calendar_events(cache),
        "week_calendar":  _week_calendar(cache),
        "projects":       _projects_from_intelligence(intelligence),
        "onedrive":       _onedrive_recent(cache),
        "teams":          _teams_chats(cache),
    }

    html = render_dashboard(data)
    _OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    _OUTPUT.write_text(html, encoding="utf-8")
    return HTMLResponse(html)


class SaveDraftRequest(BaseModel):
    subject: str
    to_email: str = ""
    body: str


@router.post("/save-draft")
async def save_draft(req: SaveDraftRequest, request: Request):
    """Save an AI-generated reply as a draft via IMAP (or Graph API for OAuth accounts)."""
    cache = request.app.state.cache
    accounts = cache.list_accounts()
    active = [a for a in accounts if getattr(a, "active", True)]
    if not active:
        return JSONResponse({"detail": "No email account connected."}, status_code=400)

    last_error = "No usable account found"
    loop = asyncio.get_event_loop()

    for acc in active:
        try:
            # Prefer IMAP append — works for Yahoo, Gmail, Hotmail, O365, generic
            if acc.password or acc.imap_host:
                from services.imap_provider import IMAPProvider
                from models import ConnectionConfig
                cfg = ConnectionConfig(
                    provider=acc.provider,
                    username=acc.username,
                    password=acc.password,
                    imap_host=acc.imap_host,
                    imap_port=acc.imap_port or 993,
                    access_token=acc.access_token,
                )
                provider = IMAPProvider(cfg)
                ok = await loop.run_in_executor(
                    None, provider.save_draft, req.to_email, req.subject, req.body
                )
                if ok:
                    return {"status": "saved", "via": "imap", "account": acc.username}
                last_error = "IMAP append failed — check server logs"
                continue

            # Fall back to Graph API for OAuth-only accounts (no IMAP password stored)
            if acc.access_token:
                import httpx
                payload: dict = {
                    "subject": req.subject[:998],
                    "body": {"contentType": "Text", "content": req.body},
                }
                if req.to_email and "@" in req.to_email:
                    payload["toRecipients"] = [{"emailAddress": {"address": req.to_email}}]
                resp = httpx.post(
                    "https://graph.microsoft.com/v1.0/me/messages",
                    headers={"Authorization": f"Bearer {acc.access_token}",
                             "Content-Type": "application/json"},
                    json=payload, timeout=8,
                )
                if resp.status_code in (200, 201):
                    return {"status": "saved", "via": "graph", "account": acc.username}
                last_error = resp.text[:200]
                continue

        except Exception as e:
            last_error = str(e)

    return JSONResponse({"detail": last_error}, status_code=500)


class DashboardAskRequest(BaseModel):
    query: str
    context: str = ""


@router.post("/ask")
async def dashboard_ask(req: DashboardAskRequest, request: Request):
    """Stream an AI answer grounded in RAG results and the clicked item context."""
    rag = request.app.state.rag
    ai = request.app.state.advisor.ai
    query = req.query.strip()
    ctx = req.context.strip()

    async def generate():
        if not query:
            yield 'data: {"type":"token","text":"Please enter a question."}\n\n'
            yield 'data: {"type":"done"}\n\n'
            return

        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, rag.hybrid_search, query, 5)

        ctx_block = f"ITEM CONTEXT:\n{ctx}\n\n" if ctx else ""
        email_block = ""
        if results:
            email_block = "RELATED EMAILS:\n" + "\n".join(
                f"- {r.get('subject', '')} from {r.get('sender', '')} "
                f"({(r.get('date') or '')[:10]})"
                for r in results[:5]
            ) + "\n\n"

        try:
            async with ai.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=600,
                system=(
                    "You are an executive assistant. Give concise, actionable advice "
                    "based on the provided item context and related emails. "
                    "If asked to schedule a meeting, include a brief agenda. "
                    "If asked to draft a reply, write the email body directly."
                ),
                messages=[{"role": "user", "content": ctx_block + email_block + "QUESTION: " + query}],
            ) as stream:
                async for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'token', 'text': f'Error: {e}'})}\n\n"

        yield 'data: {"type":"done"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
