"""Email AI endpoints — generative features (smart draft, translate, search, etc.)."""
import asyncio
import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from models import SearchRequest
from services.email_cache import EmailCache
from services.rag_engine import RAGEngine

router = APIRouter(prefix="/api/emails", tags=["email-ai"])

_log = logging.getLogger(__name__)


def _safe_err(e: Exception, label: str = "Operation") -> str:
    """Log the real error server-side; return a generic message for the client."""
    _log.error("%s failed: %s", label, e, exc_info=True)
    return f"{label} failed ({type(e).__name__})"


class CreateEventRequest(BaseModel):
    title: str
    start_datetime: str   # ISO: "2026-06-02T10:00:00"
    end_datetime: str
    attendees: list[str] = []
    description: str = ""


class ScoreDraftRequest(BaseModel):
    draft: str = Field(max_length=8000)
    context: str = Field(default="", max_length=8000)


class ScheduleSendRequest(BaseModel):
    account_id: int = 0
    to_addr: str
    subject: str
    body: str = ""
    send_at: str  # ISO datetime, e.g. "2026-07-25T09:00:00"


class NegotiationRadarRequest(BaseModel):
    text: str = Field(max_length=8000)


@router.post("/score-draft")
async def score_draft(req: ScoreDraftRequest, request: Request):
    """Score a draft reply 1-100 with suggestions and strengths."""
    from services.email_intelligence import score_draft as _score
    if not req.draft.strip():
        raise HTTPException(400, "draft required")
    advisor = request.app.state.advisor
    try:
        return await _score(advisor, req.draft, req.context)
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Draft scoring"))


@router.post("/schedule-send")
async def schedule_send(req: ScheduleSendRequest, request: Request):
    """Queue an email to be sent at a future time.

    Thin alias over the shared `scheduled_sends` table + `_scheduled_send_loop`.
    Canonical list/cancel remain on /api/scheduled-sends.
    """
    if not req.to_addr.strip() or not req.subject.strip():
        raise HTTPException(400, "to_addr and subject required")
    if not req.send_at.strip():
        raise HTTPException(400, "send_at required")
    sid = request.app.state.cache.schedule_send(
        req.account_id, req.to_addr, req.subject, req.body, req.send_at
    )
    return {"id": sid, "send_at": req.send_at, "status": "scheduled"}


@router.post("/negotiation-radar")
async def negotiation_radar(req: NegotiationRadarRequest, request: Request):
    """Extract price/deadline/commitment/concession/risk signals from email text."""
    from services.email_intelligence import negotiation_radar as _radar
    if not req.text.strip():
        raise HTTPException(400, "text required")
    advisor = request.app.state.advisor
    try:
        signals = await _radar(advisor, req.text)
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Negotiation radar"))
    return {"signals": signals, "total": len(signals)}


@router.get("/response-memory")
async def response_memory(request: Request, sender: str = ""):
    """Return the last 3 sent-email snippets to a sender + an AI-suggested opener."""
    from services.email_intelligence import suggested_opener as _opener
    sender = (sender or "").strip()
    if not sender:
        raise HTTPException(400, "sender required")

    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT subject, date, body FROM emails "
            "WHERE LOWER(folder) LIKE '%sent%' AND LOWER(recipients) LIKE ? "
            "ORDER BY date DESC LIMIT 3",
            (f"%{sender.lower()}%",),
        ).fetchall()

    snippets = []
    for r in rows:
        body = (r["body"] or "").strip().replace("\n", " ")
        snippets.append({
            "subject": r["subject"] or "",
            "date": r["date"] or "",
            "snippet": body[:300],
        })

    opener = ""
    if snippets:
        try:
            opener = await _opener(advisor, sender, [s["snippet"] for s in snippets])
        except Exception:
            opener = ""
    return {"sender": sender, "snippets": snippets, "suggested_opener": opener,
            "total": len(snippets)}


@router.post("/topic-cluster")
async def topic_cluster(request: Request):
    """Find emails related to a topic query — semantic clustering."""
    import json as _json
    body_bytes = await request.body()
    try:
        data = _json.loads(body_bytes)
        query = data.get("query", "")
        limit = min(int(data.get("limit", 15)), 50)
    except Exception:
        raise HTTPException(400, "Invalid body")
    if not query.strip():
        raise HTTPException(400, "query required")
    rag: RAGEngine = request.app.state.rag
    results = rag.semantic_search(query, n=limit)
    # Return only emails (not documents)
    emails = [r for r in results if r.get("source_type") != "document"]
    return {"query": query, "results": emails, "total": len(emails)}

@router.post("/nl-search")
async def nl_search(request: Request):
    """Convert a natural-language query to a structured SQL search."""
    import json as _json
    body_bytes = await request.body()
    try:
        data = _json.loads(body_bytes)
        query = data.get("query", "")
        limit = min(int(data.get("limit", 20)), 50)
    except Exception:
        raise HTTPException(400, "Invalid body")
    if not query.strip():
        raise HTTPException(400, "query required")

    cache: EmailCache = request.app.state.cache
    rag: RAGEngine = request.app.state.rag
    advisor = request.app.state.advisor

    # Let Claude interpret the query and extract filters
    prompt = (
        f'Convert this email search query into structured filters.\n'
        f'Query: "{query}"\n\n'
        'Return JSON with any applicable filters:\n'
        '{"keywords": ["word1","word2"], "from_sender": "name or email or null", '
        '"date_from": "YYYY-MM-DD or null", "date_to": "YYYY-MM-DD or null", '
        '"folder": "INBOX or Sent or null", "semantic_query": "refined search phrase"}'
        '\nReturn ONLY JSON.'
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
        s, e = text.find("{"), text.rfind("}") + 1
        filters = _json.loads(text[s:e]) if s >= 0 else {}
    except Exception:
        filters = {}

    # Run semantic search with the refined query
    semantic_q = filters.get("semantic_query") or query
    results = [r for r in rag.semantic_search(semantic_q, n=limit) if r.get("source_type") != "document"]

    # Also run SQL filter if sender or date filters were extracted
    sql_results = []
    from_sender = filters.get("from_sender")
    date_from = filters.get("date_from")
    if from_sender or date_from:
        summaries, _ = cache.list_emails(
            folder=filters.get("folder") or "INBOX",
            skip=0, limit=limit,
            sort_by="date", sort_order="desc",
            from_date=date_from,
        )
        for s in summaries:
            if from_sender and from_sender.lower() not in (s.sender or "").lower():
                continue
            sql_results.append({"email_id": s.id, "subject": s.subject,
                                 "sender": s.sender, "date": s.date, "text": s.preview})

    # Merge, deduplicate
    seen = set()
    merged = []
    for r in results + sql_results:
        eid = r.get("email_id") or r.get("id")
        if eid and eid not in seen:
            seen.add(eid)
            merged.append(r)

    return {"query": query, "filters": filters, "results": merged[:limit]}

@router.post("/search")
async def search(req: SearchRequest, request: Request):
    rag: RAGEngine = request.app.state.rag
    cache: EmailCache = request.app.state.cache

    results = rag.semantic_search(req.query, n=req.n_results)

    for r in results:
        cached = cache.get(r["email_id"])
        if cached:
            r["preview"] = (cached.body or "")[:300]

    return {"results": results, "total": len(results)}

@router.post("/{email_id}/quick-replies")
async def quick_replies(email_id: str, request: Request):
    """Generate 3 AI reply options (short, detailed, formal) for an email."""
    import json as _json
    cache: EmailCache = request.app.state.cache
    ai = request.app.state.advisor.ai
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    prompt = (
        f"Email from: {email.sender}\nSubject: {email.subject}\n\n"
        f"{(email.body or '')[:800]}\n\n"
        'Reply as the recipient. Return ONLY valid JSON (no markdown):\n'
        '{"short":"2-3 sentence reply","detailed":"full paragraph reply","formal":"formal professional reply"}'
    )
    raw = ""
    try:
        async with ai.messages.stream(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            system="Output ONLY valid JSON. No markdown, no explanation.",
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            async for chunk in stream.text_stream:
                raw += chunk
    except Exception as e:
        msg = str(e).lower()
        if "credit balance" in msg or "billing" in msg or "purchase credits" in msg:
            raise HTTPException(402, "AI credits exhausted — please top up your Anthropic account at console.anthropic.com")
        raise HTTPException(503, f"AI service unavailable: {e}")
    raw = raw.strip()
    try:
        start, end = raw.find("{"), raw.rfind("}") + 1
        if start >= 0 and end > start:
            return _json.loads(raw[start:end])
    except Exception:
        pass
    return {"short": raw[:200] or "No reply generated", "detailed": raw, "formal": raw[:300]}

@router.post("/{email_id}/create-event")
async def create_calendar_event(email_id: str, req: CreateEventRequest, request: Request):
    """Create a calendar event via Microsoft Graph API."""
    import httpx
    cache: EmailCache = request.app.state.cache
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    # Find a Microsoft OAuth account
    accounts = cache.list_accounts()
    ms_acc = next(
        (a for a in accounts if getattr(a, "access_token", None)
         and not getattr(a, "password", None)
         and a.provider not in ("gmail",)),
        None,
    )
    if not ms_acc:
        raise HTTPException(400, "No Microsoft OAuth account connected — sign in with Microsoft first")

    token = ms_acc.access_token
    payload: dict = {
        "subject": req.title[:255],
        "body": {"contentType": "Text", "content": req.description or f"Created from email: {email.subject}"},
        "start": {"dateTime": req.start_datetime, "timeZone": "UTC"},
        "end":   {"dateTime": req.end_datetime,   "timeZone": "UTC"},
        "attendees": [
            {"emailAddress": {"address": addr.strip()}, "type": "required"}
            for addr in req.attendees if "@" in addr
        ],
    }

    async def _post(tok: str):
        async with httpx.AsyncClient(timeout=15) as c:
            return await c.post(
                "https://graph.microsoft.com/v1.0/me/calendar/events",
                headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
                json=payload,
            )

    try:
        r = await _post(token)
        # Token expired or invalid JWT — try refresh once
        if r.status_code in (401, 400):
            new_token = await asyncio.get_event_loop().run_in_executor(
                None, cache.refresh_oauth_token, ms_acc.id
            )
            if new_token:
                r = await _post(new_token)
            else:
                raise HTTPException(401,
                    "Microsoft token expired — remove and re-add your Microsoft account in Settings → Email Accounts")
        if r.status_code == 201:
            data = r.json()
            return {"status": "created", "event_id": data.get("id", ""), "web_link": data.get("webLink", "")}
        err_msg = r.json().get("error", {}).get("message", f"Graph API error {r.status_code}")
        if "IDX14100" in err_msg or "JWT" in err_msg or "not well formed" in err_msg:
            raise HTTPException(401,
                "Microsoft token is malformed — remove and re-add your Microsoft account in Settings → Email Accounts")
        raise HTTPException(r.status_code, err_msg)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Calendar event creation"))


@router.post("/{email_id}/context-replies")
async def context_replies(email_id: str, request: Request):
    """Generate 3 context-aware reply drafts grounded in RAG knowledge."""
    import json as _json
    cache: EmailCache = request.app.state.cache
    rag: RAGEngine = request.app.state.rag
    advisor = request.app.state.advisor

    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    # RAG: find related emails and documents
    query = f"{email.subject} {(email.body or '')[:300]}"
    rag_hits = rag.semantic_search(query, n=4)
    rag_ctx = "\n\n".join(
        f"[{h.get('source_type','email')}] {h.get('subject','')}: {h.get('text','')[:300]}"
        for h in rag_hits
    )

    # Thread history for conversation continuity
    thread_history = ""
    if email.thread_id:
        with cache._conn() as conn:
            rows = conn.execute(
                "SELECT sender, date, body FROM emails "
                "WHERE thread_id = ? AND id != ? ORDER BY date DESC LIMIT 3",
                (email.thread_id, email_id),
            ).fetchall()
        thread_history = "\n---\n".join(
            f"From {r['sender']} ({(r['date'] or '')[:10]}): {(r['body'] or '')[:400]}"
            for r in rows
        )

    thread_block = f"THREAD CONTEXT:\n{thread_history}\n\n" if thread_history else ""
    prompt = f"""You are drafting 3 reply options for this email.

EMAIL:
From: {email.sender}
Subject: {email.subject}
{(email.body or '')[:1500]}

{thread_block}RELATED KNOWLEDGE (use to ground specific details):
{rag_ctx or "No related context found."}

Write exactly 3 reply drafts:
1. BRIEF: 1-2 sentences, direct acknowledgement or answer
2. DETAILED: Full reply with specifics pulled from the related knowledge above
3. CLARIFYING: A response asking the 1-2 most important questions before committing

Return ONLY valid JSON (no markdown):
{{"brief":{{"label":"Brief","body":"...","subject":"Re: ..."}},
"detailed":{{"label":"Detailed","body":"...","subject":"Re: ..."}},
"clarifying":{{"label":"Clarifying","body":"...","subject":"Re: ..."}}}}"""

    ant = getattr(advisor.ai, "_anthropic", None)
    model = "claude-haiku-4-5-20251001" if getattr(advisor.ai, "_budget_mode", False) else "claude-sonnet-4-6"
    try:
        client = ant or advisor.ai
        resp = await client.messages.create(
            model=model, max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        start, end = text.find("{"), text.rfind("}") + 1
        data = _json.loads(text[start:end]) if start >= 0 else {}
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Context replies"))

    re_subject = f"Re: {email.subject}"
    return {
        "drafts": [
            data.get("brief", {"label": "Brief", "body": "", "subject": re_subject}),
            data.get("detailed", {"label": "Detailed", "body": "", "subject": re_subject}),
            data.get("clarifying", {"label": "Clarifying", "body": "", "subject": re_subject}),
        ],
        "email_subject": email.subject,
        "email_sender": email.sender,
    }
