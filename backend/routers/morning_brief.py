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


async def _top_news() -> list[dict]:
    try:
        from routers.news import _cache as news_cache, _fetch_news
        articles: list[dict] = []
        for entry in news_cache.values():
            articles.extend(entry.get("articles", []))
        if not articles:
            # Cache empty (server restart) — fetch live with default topics
            from routers.config import load_app_config
            cfg = load_app_config()
            topics = cfg.get("news_topics") or ["business", "technology", "AI"]
            if isinstance(topics, str):
                topics = [t.strip() for t in topics.split(",") if t.strip()]
            articles = await _fetch_news(topics[:3], max_per_topic=6)
        articles.sort(key=lambda a: -a.get("relevance", 0))
        return articles[:4]
    except Exception as e:
        _log.warning("Morning brief news source failed: %s", type(e).__name__)
        return []


def _priority_emails(cache) -> list[dict]:
    try:
        # Query the last 48h of emails directly — unread preferred, recent as fallback
        db_path = getattr(cache, "db_path", None)
        if db_path:
            cutoff = (datetime.now() - __import__("datetime").timedelta(hours=48)).strftime("%Y-%m-%d")
            with sqlite3.connect(db_path) as conn:
                rows = conn.execute(
                    "SELECT subject, sender, date, is_read FROM emails "
                    "WHERE date >= ? ORDER BY date DESC LIMIT 20",
                    (cutoff,),
                ).fetchall()
            if rows:
                # Prefer unread; if none, take most recent regardless
                unread = [r for r in rows if not r[3]]
                chosen = unread[:5] if unread else rows[:5]
                return [
                    {"subject": r[0] or "(no subject)", "sender": r[1] or "", "date": r[2] or ""}
                    for r in chosen
                ]
        # Fallback: list_emails API
        result = cache.list_emails(folder="INBOX", limit=30)
        emails = result[0] if isinstance(result, tuple) else result
        emails.sort(key=lambda e: getattr(e, "date", "") or "", reverse=True)
        return [
            {"subject": getattr(e, "subject", "") or "(no subject)",
             "sender": getattr(e, "sender", ""),
             "date": getattr(e, "date", "") or ""}
            for e in emails[:5]
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


def _today_occasions(cache) -> list[dict]:
    try:
        from routers.crm import collect_occasions
        return [o for o in collect_occasions(cache, days=0) if o["days_away"] == 0]
    except Exception as e:
        _log.warning("Morning brief occasions source failed: %s", type(e).__name__)
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

    news = await _top_news()
    emails = _priority_emails(cache) if cache else []
    today = datetime.now().strftime("%Y-%m-%d")
    chase = _overdue_followups(cache, today) if cache else []
    commitments = _open_commitments(cache) if cache else []
    projects = _active_projects(cache) if cache else []
    events = await get_today_events(cache) if cache else []
    occasions = _today_occasions(cache) if cache else []

    raw = {
        "emails": emails, "news": news, "chase": chase,
        "commitments": commitments, "projects": projects, "calendar": events,
        "occasions": occasions,
    }
    ai = await _synthesize(request, raw)
    ins = ai["insights"]

    now_dt = datetime.now()
    brief = {
        "generated_at": now_dt.isoformat(),
        "greeting": f"Good morning Ali — here's your brief for {now_dt.strftime('%A, %B %-d')}",
        "sections": [
            {
                "id": "occasions", "title": "Today's Occasions", "icon": "🎂",
                "items": [
                    {"text": f'{"🎂" if o["type"] == "birthday" else "🎉"} {o["name"]}',
                     "meta": ("Birthday" if o["type"] == "birthday" else "Work Anniversary"),
                     "email": o["email"], "occasion_type": o["type"]}
                    for o in occasions
                ],
                "insight": "",
            },
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


@router.post("/morning-brief/send-now")
async def send_brief_now(request: Request):
    """Manually send today's morning brief email — useful when the scheduler missed the window."""
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from datetime import datetime as _dt, date as _date
    from routers.config import load_app_config, save_app_config
    from routers.email_send import _smtp_send

    cfg = load_app_config()
    if not cfg.get("morning_brief_email_enabled"):
        return {"status": "disabled"}
    to_email = cfg.get("morning_brief_email_to", "").strip()
    if not to_email:
        return {"status": "no_recipient"}

    cache = request.app.state.cache
    accounts = cache.list_accounts()
    smtp_acc = next((a for a in accounts if getattr(a, "password", None)), None)
    if not smtp_acc:
        return {"status": "no_smtp_account"}

    now = _dt.now()
    news = await _top_news()
    emails_list = _priority_emails(cache)
    today = _date.today().isoformat()
    chase = _overdue_followups(cache, today)
    commitments = _open_commitments(cache)
    projects = _active_projects(cache)
    events = await get_today_events(cache)

    lines = [
        f"Director Assistant — Morning Brief",
        f"{now.strftime('%A, %B %-d, %Y')}",
        "=" * 42, "",
    ]
    if events:
        lines += ["📅 TODAY'S SCHEDULE:"] + [f"  {e['start'][11:16]} – {e['end'][11:16]}  {e['title']}" for e in events] + [""]
    if emails_list:
        lines += ["📬 PRIORITY INBOX:"] + [f"  • {e['subject']}  ({e['sender']})" for e in emails_list[:5]] + [""]
    if news:
        lines += ["📰 NEWS TO KNOW:"] + [f"  • {a.get('title','')}  [{a.get('source','')}]" for a in news[:4]] + [""]
    if chase:
        lines += ["⏰ OVERDUE FOLLOW-UPS:"] + [f"  • {c['subject']} (due {c['due_date']})" for c in chase] + [""]
    if commitments:
        lines += ["🤝 OPEN COMMITMENTS:"] + [f"  • {c['description']}" for c in commitments[:5]] + [""]
    if projects:
        lines += ["📁 ACTIVE PROJECTS:"] + [f"  • {p['name']} — {p['status']}" for p in projects[:5]] + [""]
    lines += ["---", "Sent by Director Assistant"]

    msg = MIMEMultipart()
    msg["From"] = smtp_acc.username
    msg["To"] = to_email
    msg["Subject"] = f"Morning Brief — {now.strftime('%A, %B %-d')}"
    msg.attach(MIMEText("\n".join(lines), "plain", "utf-8"))

    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _smtp_send, smtp_acc, msg)

    cfg["morning_brief_last_sent"] = now.strftime("%Y-%m-%d")
    save_app_config(cfg)
    return {"status": "sent", "to": to_email}
