"""Weekly Executive Brief — AI summary of the past 7 days."""
import json
from datetime import datetime, timedelta, timezone
from cachetools import TTLCache
from fastapi import APIRouter, Request, Query

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


@router.delete("/cache")
async def clear_cache():
    _cache.clear()
    return {"cleared": True}
