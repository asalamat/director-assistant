"""Weekly Executive Brief — AI summary of the past 7 days."""
import html as _html
import json
from datetime import datetime, timedelta, timezone
from cachetools import TTLCache
from fastapi import APIRouter, HTTPException, Request, Query

router = APIRouter(prefix="/api/weekly-brief", tags=["weekly-brief"])

_cache: TTLCache = TTLCache(maxsize=1, ttl=3600)


async def generate_brief(cache, advisor) -> dict:
    """Standalone brief generator — callable from background tasks."""
    if "data" in _cache:
        return _cache["data"]

    since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, date, body, folder FROM emails
               WHERE date >= ? ORDER BY date DESC LIMIT 300""",
            (since,)
        ).fetchall()

    if not rows:
        return {"error": "No emails found in the past 7 days", "since": since}

    sent = [r for r in rows if "sent" in (r["folder"] or "").lower()]
    received = [r for r in rows if "sent" not in (r["folder"] or "").lower()]

    # Build index: row number → email id so AI can reference by index
    indexed = list(received[:80]) + list(sent[:30])
    def snippet(i, row, max_chars=180):
        return f"[{i}] [{(row['date'] or '')[:10]}] {row['sender']} | {row['subject']} | {(row['body'] or '')[:max_chars].replace(chr(10),' ')}"

    email_text = "\n".join(snippet(i, r) for i, r in enumerate(indexed))

    prompt = f"""You are an executive assistant. Generate a concise weekly brief for the past 7 days ({since} to today).

EMAILS ({len(indexed)} total, each prefixed with an index [N]):
{email_text}

Return ONLY a JSON object. Each item in the lists should be an object with:
- "text": the description
- "sources": array of email indexes [N] from the list above that support this item (1-3 indexes max, or empty [])

{{
  "period": "date range string",
  "total_received": {len(received)},
  "total_sent": {len(sent)},
  "summary": "2-3 sentence executive overview of the week",
  "action_items": [{{"text": "...", "sources": [0, 2]}}],
  "commitments_made": [{{"text": "...", "sources": [1]}}],
  "waiting_for": [{{"text": "...", "sources": [3]}}],
  "upcoming_deadlines": [{{"text": "...", "sources": []}}],
  "key_decisions": [{{"text": "...", "sources": [5]}}],
  "wins": [{{"text": "...", "sources": [4]}}],
  "relationships_to_nurture": [{{"text": "...", "sources": []}}]
}}
Be specific with names and dates. Return ONLY valid JSON."""

    ant = getattr(advisor.ai, "_anthropic", None)
    model = "claude-haiku-4-5-20251001" if advisor.ai._budget_mode else "claude-sonnet-4-6"
    try:
        if ant:
            resp = await ant.messages.create(model=model, max_tokens=2000,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model=model, max_tokens=2000,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        s, e = text.find("{"), text.rfind("}") + 1
        data = json.loads(text[s:e]) if s >= 0 else {}
    except Exception as ex:
        data = {"error": str(ex)}

    # Resolve source indexes to actual email IDs and previews
    email_map = [{"id": r["id"], "subject": r["subject"], "sender": r["sender"],
                  "date": (r["date"] or "")[:10], "folder": r["folder"] or "INBOX"}
                 for r in indexed]

    def resolve_sources(items):
        if not isinstance(items, list):
            return []
        result = []
        for item in items:
            if isinstance(item, str):
                result.append({"text": item, "emails": []})
            elif isinstance(item, dict):
                sources = item.get("sources") or []
                emails = [email_map[i] for i in sources if isinstance(i, int) and 0 <= i < len(email_map)]
                result.append({"text": item.get("text", ""), "emails": emails})
        return result

    for key in ["action_items", "commitments_made", "waiting_for", "upcoming_deadlines",
                "key_decisions", "wins", "relationships_to_nurture"]:
        data[key] = resolve_sources(data.get(key, []))

    data["generated_at"] = datetime.now(timezone.utc).isoformat()
    data["since"] = since
    _cache["data"] = data
    return data


@router.post("")
async def generate_weekly_brief(request: Request):
    """Generate an AI executive brief for the past 7 days."""
    return await generate_brief(request.app.state.cache, request.app.state.advisor)


@router.get("/search")
async def search_brief_item(request: Request, q: str = Query(...)):
    """Find emails related to a brief item keyword."""
    cache = request.app.state.cache
    rag = request.app.state.rag
    results = rag.semantic_search(q, n=8)
    emails = [r for r in results if r.get("source_type") != "document"][:6]
    # Also FTS search
    fts = cache.fts_search(q, limit=6)
    seen = {e.get("email_id") for e in emails}
    for s in fts:
        if s.id not in seen:
            emails.append({"email_id": s.id, "subject": s.subject, "sender": s.sender,
                           "date": s.date, "text": s.preview})
            seen.add(s.id)
    return {"query": q, "emails": emails[:8]}


_SECTIONS = [
    ("summary", "Summary"),
    ("action_items", "Action Items"),
    ("commitments_made", "Commitments Made"),
    ("waiting_for", "Waiting For"),
    ("upcoming_deadlines", "Upcoming Deadlines"),
    ("key_decisions", "Key Decisions"),
    ("wins", "Wins"),
    ("relationships_to_nurture", "Relationships to Nurture"),
]


def _brief_to_text_html(brief: dict) -> tuple[str, str]:
    lines = ["Cortex Executive Inbox — Weekly Brief", "=" * 40, ""]
    period = brief.get("period") or brief.get("since") or ""
    if period:
        lines.append(f"Period: {period}")
        lines.append("")

    html_body = '<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">'
    html_body += '<h2 style="color:#1d4ed8">Cortex Executive Inbox — Weekly Brief</h2>'
    if period:
        html_body += f'<p style="color:#6b7280;margin:0 0 16px">{_html.escape(str(period))}</p>'

    for key, title in _SECTIONS:
        value = brief.get(key)
        if not value:
            continue
        if key == "summary":
            lines.append(f"## {title}")
            lines.append(f"  {value}")
            lines.append("")
            html_body += f"<h3 style='color:#1d4ed8;margin:16px 0 6px'>{title}</h3>"
            html_body += f"<p style='margin:0'>{_html.escape(str(value))}</p>"
            continue
        items = value if isinstance(value, list) else [value]
        rendered = []
        for item in items:
            text = item.get("text") if isinstance(item, dict) else str(item)
            if text:
                rendered.append(text)
        if not rendered:
            continue
        lines.append(f"## {title}")
        for text in rendered:
            lines.append(f"  • {text}")
        lines.append("")
        html_body += f"<h3 style='color:#1d4ed8;margin:16px 0 6px'>{title}</h3>"
        html_body += "<ul style='margin:0;padding-left:20px'>"
        for text in rendered:
            html_body += f"<li style='margin-bottom:4px'>{_html.escape(text)}</li>"
        html_body += "</ul>"

    html_body += '<hr style="margin-top:24px;border:none;border-top:1px solid #e5e7eb">'
    html_body += '<p style="font-size:12px;color:#9ca3af">Sent from Cortex Executive Inbox</p>'
    html_body += "</body></html>"
    return "\n".join(lines), html_body


@router.post("/send-to-inbox")
async def send_brief_to_inbox(request: Request):
    """Generate the weekly brief and email it to the user's own address."""
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from .email_send import _smtp_send

    cache = request.app.state.cache
    advisor = request.app.state.advisor

    accounts = cache.list_accounts()
    if not accounts:
        raise HTTPException(400, "No email accounts configured")
    acc = accounts[0]
    to_addr = acc.username

    brief = await generate_brief(cache, advisor)
    if brief.get("error"):
        raise HTTPException(400, brief["error"])

    plain, html_body = _brief_to_text_html(brief)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Your Cortex Executive Inbox Weekly Brief"
    msg["From"] = to_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    _smtp_send(acc, msg)
    return {"sent": True, "to": to_addr}


@router.delete("/cache")
async def clear_cache():
    _cache.clear()
    return {"cleared": True}
