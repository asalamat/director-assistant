"""Morning brief — synthesizes news, emails, follow-ups, commitments and projects into a daily executive briefing."""

import json
import logging
import re
import sqlite3
import time
from datetime import datetime
from fastapi import APIRouter, Request

from routers.calendar import get_today_events

router = APIRouter(prefix="/api", tags=["morning-brief"])
_log = logging.getLogger(__name__)

_cache_store: dict[str, dict] = {}
CACHE_TTL = 1800  # 30 minutes


def _top_news() -> list[dict]:
    try:
        from routers.news import _cache as news_cache
        articles: list[dict] = []
        for entry in news_cache.values():
            articles.extend(entry.get("articles", []))
        articles.sort(key=lambda a: -a.get("relevance", 0))
        return articles[:3]
    except Exception as e:
        _log.warning("Morning brief news source failed: %s", type(e).__name__)
        return []


def _priority_emails(cache) -> list[dict]:
    try:
        result = cache.list_emails(folder="INBOX", limit=30)
        emails = result[0] if isinstance(result, tuple) else result
        unread = []
        for e in emails:
            is_read = getattr(e, "is_read", True)
            if is_read in (False, 0):
                unread.append(e)
        unread.sort(key=lambda e: getattr(e, "date", "") or "", reverse=True)
        return [
            {
                "subject": getattr(e, "subject", "") or "(no subject)",
                "sender": getattr(e, "sender", ""),
                "date": getattr(e, "date", "") or "",
            }
            for e in unread[:5]
        ]
    except Exception as e:
        _log.warning("Morning brief email source failed: %s", type(e).__name__)
        return []


def _overdue_followups(cache, today: str) -> list[dict]:
    try:
        follow_ups = cache.list_follow_ups(done=False)
        items = []
        for f in follow_ups:
            due = getattr(f, "due_date", "") or ""
            if due and due[:10] <= today:
                items.append({
                    "subject": getattr(f, "subject", "") or "(no subject)",
                    "contact": getattr(f, "sender", ""),
                    "due_date": due[:10],
                })
        return items[:5]
    except Exception as e:
        _log.warning("Morning brief follow-ups source failed: %s", type(e).__name__)
        return []


def _query(cache, sql: str) -> list[tuple]:
    db_path = getattr(cache, "db_path", None)
    if not db_path:
        return []
    with sqlite3.connect(db_path) as conn:
        return conn.execute(sql).fetchall()


def _open_commitments(cache) -> list[dict]:
    try:
        rows = _query(
            cache,
            "SELECT id, description, due_date, status FROM commitments "
            "WHERE status != 'done' ORDER BY due_date ASC LIMIT 5",
        )
        return [
            {"id": r[0], "description": r[1] or "", "due_date": r[2] or "", "status": r[3] or ""}
            for r in rows
        ]
    except Exception as e:
        _log.warning("Morning brief commitments source failed: %s", type(e).__name__)
        return []


def _active_projects(cache) -> list[dict]:
    try:
        rows = _query(
            cache,
            "SELECT id, name, status FROM projects "
            "WHERE status NOT IN ('done','cancelled') LIMIT 5",
        )
        return [{"id": r[0], "name": r[1] or "", "status": r[2] or ""} for r in rows]
    except Exception as e:
        _log.warning("Morning brief projects source failed: %s", type(e).__name__)
        return []


async def _synthesize(request: Request, data: dict) -> dict:
    """Ask Claude Haiku for one-liner insights per section plus a focus sentence."""
    result = {"insights": {}, "focus": ""}
    ai = getattr(getattr(request.app.state, "advisor", None), "ai", None)
    if ai is None:
        return result
    prompt = (
        "You are an executive assistant writing a morning brief for Ali. "
        "Given the raw data below, write a concise one-line insight for each section "
        "and a single 'focus' sentence naming the most important thing to do today.\n\n"
        f"DATA:\n{json.dumps(data, default=str)[:4000]}\n\n"
        "Reply ONLY as JSON: "
        '{"insights":{"emails":"...","news":"...","chase":"...","commitments":"...","projects":"...","calendar":"..."},'
        '"focus":"..."}'
    )
    try:
        resp = await ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
            result["insights"] = parsed.get("insights", {}) or {}
            result["focus"] = str(parsed.get("focus", "") or "")
    except Exception as e:
        _log.warning("Morning brief AI synthesis failed: %s", type(e).__name__)
    return result


@router.get("/morning-brief")
async def morning_brief(request: Request, force: bool = False):
    now = time.time()
    cached = _cache_store.get("brief")
    if not force and cached and (now - cached["at"]) < CACHE_TTL:
        out = dict(cached["data"])
        out["cached"] = True
        return out

    cache = getattr(request.app.state, "cache", None)

    news = _top_news()
    emails = _priority_emails(cache) if cache else []
    today = datetime.now().strftime("%Y-%m-%d")
    chase = _overdue_followups(cache, today) if cache else []
    commitments = _open_commitments(cache) if cache else []
    projects = _active_projects(cache) if cache else []
    events = await get_today_events(cache) if cache else []

    raw = {
        "emails": emails, "news": news, "chase": chase,
        "commitments": commitments, "projects": projects, "calendar": events,
    }
    ai = await _synthesize(request, raw)
    ins = ai["insights"]

    now_dt = datetime.now()
    brief = {
        "generated_at": now_dt.isoformat(),
        "greeting": f"Good morning Ali — here's your brief for {now_dt.strftime('%A, %B %-d')}",
        "sections": [
            {
                "id": "calendar", "title": "Today's Schedule", "icon": "📅",
                "items": [
                    {"text": e["title"], "meta": f'{e["start"][11:16]} – {e["end"][11:16]}' + (" · Online" if e["is_online"] else "")}
                    for e in events
                ],
                "insight": str(ins.get("calendar", "")),
            },
            {
                "id": "emails", "title": "Priority Inbox", "icon": "📬",
                "items": [{"text": e["subject"], "meta": e["sender"]} for e in emails],
                "insight": str(ins.get("emails", "")),
            },
            {
                "id": "news", "title": "News to Know", "icon": "📰",
                "items": [
                    {"text": a.get("title", ""),
                     "meta": f'{a.get("source", "")} · {a.get("topic", "")}'.strip(" ·")}
                    for a in news
                ],
                "insight": str(ins.get("news", "")),
            },
            {
                "id": "chase", "title": "Overdue Follow-ups", "icon": "⏰",
                "items": [{"text": c["subject"], "meta": f'due {c["due_date"]}'} for c in chase],
                "insight": str(ins.get("chase", "")),
            },
            {
                "id": "commitments", "title": "Open Commitments", "icon": "🤝",
                "items": [
                    {"text": c["description"],
                     "meta": f'due {c["due_date"]}' if c["due_date"] else c["status"]}
                    for c in commitments
                ],
                "insight": str(ins.get("commitments", "")),
            },
            {
                "id": "projects", "title": "Active Projects", "icon": "📁",
                "items": [{"text": p["name"], "meta": p["status"]} for p in projects],
                "insight": str(ins.get("projects", "")),
            },
        ],
        "focus": ai["focus"],
        "cached": False,
    }

    _cache_store["brief"] = {"at": now, "data": brief}
    return brief
