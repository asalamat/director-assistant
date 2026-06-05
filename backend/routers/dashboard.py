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

# Simple in-process cache for Graph API results (avoid re-fetching on every load)
_graph_cache: dict[str, tuple[float, Any]] = {}
_GRAPH_TTL = 120  # seconds


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


async def _fetch_graph_data(cache) -> dict[str, list]:
    """Fetch all Graph API data in parallel with a shared cache."""
    import time, httpx

    now = time.monotonic()
    cached = _graph_cache.get("graph")
    if cached and (now - cached[0]) < _GRAPH_TTL:
        return cached[1]

    accounts = cache.list_accounts()
    acc = next((a for a in accounts if getattr(a, "access_token", None) and not getattr(a, "password", None)), None)
    empty = {"calendar_today": [], "week_calendar": [], "onedrive": []}
    if not acc:
        return empty

    token = acc.access_token

    async def _get(url: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                r = await c.get(url, headers={"Authorization": f"Bearer {token}"})
                if r.status_code == 401:
                    # Try refresh once
                    new_token = await asyncio.get_event_loop().run_in_executor(
                        None, cache.refresh_oauth_token, acc.id
                    )
                    if new_token:
                        async with httpx.AsyncClient(timeout=8) as c2:
                            r = await c2.get(url, headers={"Authorization": f"Bearer {new_token}"})
                return r.json() if r.status_code == 200 else {}
        except Exception:
            return {}

    tomorrow = date.today() + timedelta(days=1)
    today = date.today()
    cal_url = (
        "https://graph.microsoft.com/v1.0/me/calendarView"
        f"?startDateTime={tomorrow.isoformat()}T00:00:00Z"
        f"&endDateTime={tomorrow.isoformat()}T23:59:59Z"
        "&$select=subject,start,end,organizer,responseStatus,isOnlineMeeting,attendees"
        "&$orderby=start/dateTime&$top=20"
    )
    week_url = (
        "https://graph.microsoft.com/v1.0/me/calendarView"
        f"?startDateTime={today.isoformat()}T00:00:00Z"
        f"&endDateTime={(today + timedelta(days=7)).isoformat()}T23:59:59Z"
        "&$select=subject,start,end,categories&$top=50"
    )
    od_url = (
        "https://graph.microsoft.com/v1.0/me/drive/recent"
        "?$select=name,webUrl,lastModifiedDateTime,size&$top=10"
    )

    cal_data, week_data, od_data = await asyncio.gather(
        _get(cal_url), _get(week_url), _get(od_url)
    )

    result = {
        "calendar_today": cal_data.get("value", []),
        "week_calendar":  week_data.get("value", []),
        "onedrive":       od_data.get("value", []),
    }
    _graph_cache["graph"] = (now, result)
    return result


def _teams_chats(_cache) -> list[dict]:
    """Teams Chat.Read is not available for personal Microsoft accounts."""
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


def _user_projects(cache) -> list[dict]:
    """Named projects from the projects table (created by user)."""
    try:
        with _db_conn(cache) as conn:
            rows = conn.execute(
                """SELECT p.id, p.name, p.description, p.status, p.created_at,
                          COUNT(pe.email_id) as email_count
                   FROM projects p
                   LEFT JOIN project_emails pe ON pe.project_id = p.id
                   WHERE p.status != 'resolved'
                   GROUP BY p.id ORDER BY p.created_at DESC"""
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _vip_contacts(cache) -> list[dict]:
    """VIP contacts with basic stats."""
    try:
        with _db_conn(cache) as conn:
            vips = conn.execute("SELECT * FROM vip_contacts ORDER BY name").fetchall()
        result = []
        for v in vips:
            v = dict(v)
            with _db_conn(cache) as conn:
                stats = conn.execute(
                    """SELECT COUNT(*) as total, MAX(date) as last_received,
                              SUM(CASE WHEN is_read=0 THEN 1 ELSE 0 END) as unread
                       FROM emails WHERE LOWER(sender) LIKE ?""",
                    (f"%{v['email_addr'].lower()}%",)
                ).fetchone()
                sent = conn.execute(
                    """SELECT MAX(date) as last_sent FROM emails
                       WHERE LOWER(folder) LIKE '%sent%' AND LOWER(recipients) LIKE ?""",
                    (f"%{v['email_addr'].lower()}%",)
                ).fetchone()
            v["emails_received"] = stats["total"] if stats else 0
            v["last_received"] = (stats["last_received"] or "")[:10] if stats else ""
            v["unread"] = stats["unread"] if stats else 0
            v["last_sent_to"] = (sent["last_sent"] or "")[:10] if sent else ""
            v["awaiting_reply"] = bool(
                v["last_sent_to"] and v["last_received"] and
                v["last_sent_to"] > v["last_received"]
            )
            result.append(v)
        return result
    except Exception:
        return []


def _chase_queue(cache, days: int = 3) -> list[dict]:
    """Sent emails with no reply for more than `days` days."""
    try:
        from services.waiting_reply import get_waiting_replies
        return get_waiting_replies(cache, days, 10)
    except Exception:
        return []


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("", response_class=HTMLResponse)
async def get_dashboard(request: Request):
    cache = request.app.state.cache
    intelligence = request.app.state.intelligence
    loop = asyncio.get_event_loop()

    # Run all data fetchers in parallel
    (
        unread_count, unread_emails, actions, follow_ups,
        top_senders, email_volume, training, projects,
        user_projects, vips, chase, graph
    ) = await asyncio.gather(
        loop.run_in_executor(None, _unread_count, cache),
        loop.run_in_executor(None, _unread_emails, cache),
        loop.run_in_executor(None, _action_items, cache),
        loop.run_in_executor(None, _follow_ups, cache),
        loop.run_in_executor(None, _top_senders, cache),
        loop.run_in_executor(None, _emails_by_day, cache),
        loop.run_in_executor(None, _training_emails, cache),
        loop.run_in_executor(None, _projects_from_intelligence, intelligence),
        loop.run_in_executor(None, _user_projects, cache),
        loop.run_in_executor(None, _vip_contacts, cache),
        loop.run_in_executor(None, _chase_queue, cache),
        _fetch_graph_data(cache),
    )

    data: dict[str, Any] = {
        "generated_at":   datetime.now().strftime("%A, %d %B %Y  %H:%M"),
        "unread_count":   unread_count,
        "unread_emails":  unread_emails,
        "actions":        actions,
        "follow_ups":     follow_ups,
        "top_senders":    top_senders,
        "email_volume":   email_volume,
        "training":       training,
        "calendar_today": graph["calendar_today"],
        "week_calendar":  graph["week_calendar"],
        "projects":       projects,
        "user_projects":  user_projects,
        "vip_contacts":   vips,
        "chase_queue":    chase,
        "onedrive":       graph["onedrive"],
        "teams":          [],
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
            from services.email_provider import build_provider
            from models import ConnectionConfig
            cfg = ConnectionConfig(
                provider=acc.provider,
                username=acc.username,
                password=acc.password,
                imap_host=acc.imap_host,
                imap_port=acc.imap_port or 993,
                access_token=acc.access_token,
            )
            provider = build_provider(cfg)
            ok = await loop.run_in_executor(
                None, provider.save_draft, req.to_email, req.subject, req.body
            )
            if ok:
                via = "graph" if (acc.access_token and not acc.password) else "imap"
                return {"status": "saved", "via": via, "account": acc.username}
            last_error = "Draft save failed — check server logs"
        except Exception as e:
            last_error = str(e)

    return JSONResponse({"detail": last_error}, status_code=500)


class MeetingPrepRequest(BaseModel):
    subject: str
    start_time: str = ""
    attendee_emails: list[str] = []


@router.post("/meeting-prep")
async def meeting_prep(req: MeetingPrepRequest, request: Request):
    """Stream an AI meeting prep brief grounded in attendee email history."""
    rag = request.app.state.rag
    ai = request.app.state.advisor.ai

    async def generate():
        if not req.subject:
            yield 'data: {"type":"token","text":"No meeting subject provided."}\n\n'
            yield 'data: {"type":"done"}\n\n'
            return

        loop = asyncio.get_event_loop()
        subj_results = await loop.run_in_executor(None, rag.hybrid_search, req.subject, 5)
        attendee_results = []
        for addr in req.attendee_emails[:4]:
            r = await loop.run_in_executor(None, rag.hybrid_search, addr, 3)
            attendee_results.extend(r)

        seen: set = set()
        all_results = []
        for r in subj_results + attendee_results:
            rid = r.get("email_id") or r.get("id", "")
            if rid and rid not in seen:
                seen.add(rid)
                all_results.append(r)

        ctx = (
            f"MEETING: {req.subject}\n"
            f"Time: {req.start_time}\n"
            f"Attendees: {', '.join(req.attendee_emails)}\n\n"
        )
        if all_results:
            ctx += "RELEVANT EMAIL CONTEXT:\n" + "\n".join(
                f"- {r.get('subject', '')} | From: {r.get('sender', '')} | {(r.get('date', ''))[:10]}"
                for r in all_results[:8]
            ) + "\n\n"

        try:
            async with ai.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                system=(
                    "You are an executive assistant. Generate a concise meeting prep brief. "
                    "Format with bold section headers. Be specific and actionable."
                ),
                messages=[{"role": "user", "content": ctx +
                    "Generate a meeting prep brief with:\n"
                    "**Suggested Agenda** (3-5 items)\n"
                    "**Key Talking Points**\n"
                    "**Open Items / Questions** (from email context)\n"
                    "**Background** (relevant prior communication)"}],
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
