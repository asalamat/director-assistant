"""Email AI endpoints — generative features (smart draft, translate, search, etc.)."""
import asyncio
import json as _json
import logging
from enum import Enum
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, List

from models import SearchRequest
from services.email_cache import EmailCache
from services.rag_engine import RAGEngine

router = APIRouter(prefix="/api/emails", tags=["email-ai"])

_log = logging.getLogger(__name__)


def _safe_err(e: Exception, label: str = "Operation") -> str:
    """Log the real error server-side; return a generic message for the client."""
    _log.error("%s failed: %s", label, e, exc_info=True)
    return f"{label} failed ({type(e).__name__})"

# Cache thread summaries to avoid re-summarizing the same conversation.
_thread_summary_cache: dict[str, dict] = {}


class CreateEventRequest(BaseModel):
    title: str
    start_datetime: str   # ISO: "2026-06-02T10:00:00"
    end_datetime: str
    attendees: list[str] = []
    description: str = ""


class AnalyzeToneRequest(BaseModel):
    text: str = Field(max_length=4000)


class RewriteTone(str, Enum):
    warmer = "warmer"
    more_direct = "more_direct"
    more_formal = "more_formal"
    shorter = "shorter"
    more_enthusiastic = "more_enthusiastic"
    more_concise = "more_concise"


class RewriteOptionsRequest(BaseModel):
    text: str = Field(max_length=4000)
    tones: list[RewriteTone] = Field(min_length=1)



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

@router.post("/{email_id}/smart-draft")
async def smart_draft(email_id: str, request: Request):
    """Generate a complete, ready-to-send draft reply with full context awareness."""
    cache: EmailCache = request.app.state.cache
    rag: RAGEngine = request.app.state.rag
    advisor = request.app.state.advisor

    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    # Thread history for full conversation context
    thread_history = []
    if email.thread_id:
        with cache._conn() as conn:
            t_rows = conn.execute(
                "SELECT subject, sender, date, body FROM emails "
                "WHERE thread_id = ? AND id != ? ORDER BY date ASC LIMIT 5",
                (email.thread_id, email_id),
            ).fetchall()
            thread_history = [
                f"From: {r['sender']}  ({(r['date'] or '')[:10]})\n{(r['body'] or '')[:600]}"
                for r in t_rows
            ]

    # Related documents for grounding
    doc_query = f"{email.subject} {(email.body or '')[:300]}"
    related_docs = [
        f"[{d.get('source_type','doc')}] {d.get('subject','')}\n{d.get('text','')[:400]}"
        for d in rag.semantic_search(doc_query, n=3)
        if d.get("source_type") == "document"
    ]

    # User's recent sent emails for style matching
    with cache._conn() as conn:
        sent_rows = conn.execute(
            """SELECT body FROM emails WHERE LOWER(folder) LIKE '%sent%'
               ORDER BY date DESC LIMIT 5""",
        ).fetchall()
    style_examples = "\n---\n".join((r["body"] or "")[:300] for r in sent_rows if r["body"])

    # Learned writing-style profile (Voice-Matched Drafts) — account 0
    learned_style = ""
    with cache._conn() as conn:
        srow = conn.execute(
            "SELECT style_json FROM writing_style_cache WHERE account_id = 0 "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if srow and srow["style_json"]:
        try:
            st = _json.loads(srow["style_json"])
            learned_style = (
                "\nLEARNED WRITING STYLE (match this profile precisely):\n"
                f"- Formality: {st.get('formality', 'neutral')}\n"
                f"- Greeting: {st.get('greeting_style', 'natural')}\n"
                f"- Closing: {st.get('closing_style', 'natural')}\n"
                f"- Signature name: {st.get('signature_name') or 'omit if unknown'}\n"
                f"- Punctuation: {st.get('punctuation', 'standard')}\n"
                f"- Emoji usage: {st.get('emoji_usage', 'none')}\n"
                f"- Vocabulary: {st.get('vocabulary', 'moderate')}\n"
                f"- Tone: {st.get('tone', 'professional')}\n"
            )
        except Exception:
            learned_style = ""

    thread_ctx = "\n\n".join(thread_history) or "No prior messages."
    doc_ctx    = "\n\n".join(related_docs) or "No related documents."
    style_ctx  = style_examples or "No sent mail available for style matching."

    # Manual persona description from Settings
    from routers.config import load_app_config as _load_cfg
    _cfg = _load_cfg()
    persona_desc = (_cfg.get("email_persona") or "").strip()
    persona_block = f"\nUSER PERSONA & TONE:\n{persona_desc}\n" if persona_desc else ""

    prompt = f"""You are ghostwriting a complete email reply on behalf of the recipient.

ORIGINAL EMAIL:
From: {email.sender}
Subject: {email.subject}
Date: {email.date}

{(email.body or '')[:3000]}

THREAD HISTORY (earlier messages, oldest first):
{thread_ctx}

RELATED DOCUMENTS:
{doc_ctx}

STYLE REFERENCE (recent sent emails — match this tone and formality):
{style_ctx}
{persona_block}{learned_style}
Write ONE complete, professional email reply. Include:
- An appropriate greeting
- A substantive body that addresses all points in the original email
- A natural sign-off

Match the language, tone, and formality of the conversation.
Return ONLY the email body text — no subject line, no JSON, no markdown."""

    ant = getattr(advisor.ai, "_anthropic", None)
    model = "claude-haiku-4-5-20251001" if advisor.ai._budget_mode else "claude-sonnet-4-6"

    if ant:
        resp = await ant.messages.create(
            model=model, max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        draft = resp.content[0].text.strip()
    else:
        resp = await advisor.ai.messages.create(
            model=model, max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        draft = resp.content[0].text.strip()

    subject = email.subject or ""
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    return {"draft": draft, "subject": subject, "to": email.sender}

@router.post("/{email_id}/summarize-thread")
async def summarize_thread(email_id: str, request: Request):
    """Summarize an entire email thread into key points."""
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor

    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    cache_key = email.thread_id or email_id
    cached_summary = _thread_summary_cache.get(cache_key)
    if cached_summary is not None:
        return cached_summary

    # Fetch all messages in the thread
    thread_msgs = []
    if email.thread_id:
        with cache._conn() as conn:
            rows = conn.execute(
                "SELECT subject, sender, date, body FROM emails "
                "WHERE thread_id = ? ORDER BY date ASC LIMIT 20",
                (email.thread_id,),
            ).fetchall()
            thread_msgs = [dict(r) for r in rows]
    if not thread_msgs:
        thread_msgs = [{"subject": email.subject, "sender": email.sender,
                        "date": email.date, "body": email.body}]

    thread_text = "\n\n---\n\n".join(
        f"From: {m['sender']}  ({(m['date'] or '')[:10]})\n{(m['body'] or '')[:600]}"
        for m in thread_msgs
    )

    prompt = f"""Summarize this email thread concisely.

THREAD ({len(thread_msgs)} messages):
{thread_text}

Return JSON with exactly these fields:
{{"summary": "2-3 sentence overview of the thread", "key_points": ["bullet 1", "bullet 2", "bullet 3"], "outcome": "one sentence on current status or what is needed next", "participants": ["name/email list"]}}
Return ONLY valid JSON."""

    ant = getattr(advisor.ai, "_anthropic", None)
    model = "claude-haiku-4-5-20251001"
    import json as _json
    try:
        if ant:
            resp = await ant.messages.create(model=model, max_tokens=600,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model=model, max_tokens=600,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        start, end = text.find("{"), text.rfind("}") + 1
        data = _json.loads(text[start:end]) if start >= 0 else {}
    except Exception:
        data = {}
    result = {
        "summary": data.get("summary", ""),
        "key_points": data.get("key_points", []),
        "outcome": data.get("outcome", ""),
        "participants": data.get("participants", []),
        "message_count": len(thread_msgs),
    }
    if result["summary"]:
        _thread_summary_cache[cache_key] = result
    return result

@router.post("/{email_id}/extract-commitments")
async def extract_commitments(email_id: str, request: Request):
    """Extract commitments/promises from a draft reply text."""
    import json as _json
    advisor = request.app.state.advisor
    body_bytes = await request.body()
    try:
        draft_text = _json.loads(body_bytes).get("draft", "")
    except Exception:
        raise HTTPException(400, "Invalid body")
    if not draft_text.strip():
        return {"commitments": []}

    prompt = f"""Extract any commitments, promises, or action items from this email draft.
Look for: "I will", "I'll", "Will send", "Let's", "I promise", "By [date]", "I'll follow up", scheduled meetings, deliverables.

DRAFT:
{draft_text[:2000]}

Return JSON: {{"commitments": ["commitment 1", "commitment 2"]}}
Return ONLY JSON. If no commitments found, return {{"commitments": []}}"""

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=300,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        start, end = text.find("{"), text.rfind("}") + 1
        data = _json.loads(text[start:end]) if start >= 0 else {}
    except Exception:
        data = {}
    return {"commitments": data.get("commitments", [])}

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

@router.post("/bulk-draft")
async def bulk_draft(request: Request):
    """Generate smart draft replies for multiple emails at once."""
    import json as _json
    body_bytes = await request.body()
    try:
        data = _json.loads(body_bytes)
        email_ids = data.get("email_ids", [])[:10]
    except Exception:
        raise HTTPException(400, "Invalid body")
    if not email_ids:
        raise HTTPException(400, "email_ids required")
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor
    ant = getattr(advisor.ai, "_anthropic", None)
    from routers.config import load_app_config as _load_cfg
    _persona = (_load_cfg().get("email_persona") or "").strip()
    _persona_line = f"\nUSER PERSONA & TONE:\n{_persona}\n" if _persona else ""
    drafts = []
    for email_id in email_ids:
        email = cache.get(email_id)
        if not email:
            continue
        body = (email.body or "")[:1500]
        subject = f"Re: {email.subject}" if not (email.subject or "").lower().startswith("re:") else email.subject
        prompt = (f"Write a brief professional reply to this email.\n"
                  f"From: {email.sender}\nSubject: {email.subject}\n{_persona_line}\n{body}\n\n"
                  "Return ONLY the email body text, no subject line.")
        try:
            if ant:
                resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=400,
                    messages=[{"role": "user", "content": prompt}])
                draft_text = resp.content[0].text.strip()
            else:
                resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=400,
                    messages=[{"role": "user", "content": prompt}])
                draft_text = resp.content[0].text.strip()
            drafts.append({"email_id": email_id, "subject": subject or "", "to": email.sender or "", "draft": draft_text})
        except Exception as e:
            drafts.append({"email_id": email_id, "subject": subject or "", "to": email.sender or "",
                           "draft": f"Error: {_safe_err(e, 'Draft generation')}"})
    return {"drafts": drafts}

@router.post("/adjust-tone")
async def adjust_tone(request: Request):
    """Rewrite a text excerpt in a different tone."""
    import json as _json
    body_bytes = await request.body()
    try:
        data = _json.loads(body_bytes)
        text = data.get("text", "")
        tone = data.get("tone", "formal")
    except Exception:
        raise HTTPException(400, "Invalid body")
    if not text.strip():
        raise HTTPException(400, "text required")
    TONE_PROMPTS = {
        "formal": "Rewrite this text to be more formal and professional.",
        "casual": "Rewrite this text to be more conversational and casual.",
        "shorter": "Rewrite this text to be significantly shorter while keeping all key information.",
        "friendlier": "Rewrite this text to be warmer and more friendly.",
        "direct": "Rewrite this text to be more direct and assertive, cutting any unnecessary words.",
        "improve": (
            "You are helping someone improve their email reply. "
            "Keep their exact opinion, stance, and intent — do NOT change what they are saying or agreeing to. "
            "Only fix grammar, clarity, and professionalism. "
            "If they are declining or disagreeing, keep that disagreement intact. "
            "Return ONLY the improved text."
        ),
    }
    instruction = TONE_PROMPTS.get(tone, TONE_PROMPTS["formal"])
    advisor = request.app.state.advisor
    ant = getattr(advisor.ai, "_anthropic", None)
    prompt = f"{instruction}\n\nOriginal:\n{text[:2000]}\n\nReturn ONLY the rewritten text, no preamble."
    try:
        if ant:
            resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=800,
                messages=[{"role": "user", "content": prompt}])
            result = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=800,
                messages=[{"role": "user", "content": prompt}])
            result = resp.content[0].text.strip()
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Tone adjustment"))
    return {"result": result}


@router.post("/draft-from-idea")
async def draft_from_idea(request: Request):
    """Turn rough notes/ideas into a complete, polished email body."""
    import json as _json
    body_bytes = await request.body()
    try:
        data = _json.loads(body_bytes)
        text = data.get("text", "").strip()
        subject = data.get("subject", "").strip()
        to = data.get("to", "").strip()
    except Exception:
        raise HTTPException(400, "Invalid body")
    if not text:
        raise HTTPException(400, "text required")
    context_lines = []
    if to:
        context_lines.append(f"Recipient: {to}")
    if subject:
        context_lines.append(f"Subject: {subject}")
    context = "\n".join(context_lines)
    prompt = (
        "You are an expert email writer. The user has written rough notes or ideas below. "
        "Transform them into a complete, professional, well-structured email body. "
        "Preserve all the user's key points and intent — just make it clear, polished, and ready to send. "
        + (f"\n\n{context}" if context else "")
        + f"\n\nUser's rough notes:\n{text[:2000]}"
        + "\n\nReturn ONLY the email body text. No subject line, no 'Subject:' prefix. Start directly with the greeting or first sentence."
    )
    advisor = request.app.state.advisor
    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=1000,
                messages=[{"role": "user", "content": prompt}])
            result = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=1000,
                messages=[{"role": "user", "content": prompt}])
            result = resp.content[0].text.strip()
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Draft from idea"))
    return {"result": result}


@router.post("/analyze-tone")
async def analyze_tone(req: AnalyzeToneRequest, request: Request):
    """Analyze the tone of a draft and detect issues (passive-aggressive, no clear ask, etc.)."""
    if not req.text.strip():
        raise HTTPException(400, "text required")
    advisor = request.app.state.advisor
    try:
        return await advisor.analyze_tone(req.text)
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Tone analysis"))

@router.post("/rewrite-options")
async def rewrite_options(req: RewriteOptionsRequest, request: Request):
    """Rewrite a draft in one or more requested tones (allowlist-validated)."""
    if not req.text.strip():
        raise HTTPException(400, "text required")
    advisor = request.app.state.advisor
    tones = [t.value for t in req.tones]
    try:
        rewrites = await advisor.batch_rewrite(req.text, tones)
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Rewrite"))
    return {"rewrites": rewrites}

@router.post("/{email_id}/translate")
async def translate_email(email_id: str, request: Request):
    """Translate an email body into the target language."""
    import json as _json, re as _re
    body_bytes = await request.body()
    try:
        target_lang = _json.loads(body_bytes).get("target_lang", "English") or "English"
    except Exception:
        target_lang = "English"

    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    # Clean body: strip HTML tags, decode entities, collapse whitespace
    raw = (email.body or "").strip()
    if not raw:
        raise HTTPException(400, "Email has no body to translate")
    text = _re.sub(r'<(style|script)[^>]*>.*?</\1>', ' ', raw, flags=_re.IGNORECASE | _re.DOTALL)
    text = _re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
    text = _re.sub(r'\s+', ' ', text).strip()[:4000]
    if not text:
        raise HTTPException(400, "Email body has no readable text after stripping HTML")

    # Ask for plain translation — no JSON, no parsing issues
    prompt = (
        f"Translate the following email into {target_lang}. "
        f"Return ONLY the translated text — no introduction, no explanation, no quotes.\n\n"
        f"{text}"
    )

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=2500,
                messages=[{"role": "user", "content": prompt}],
            )
            translation = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=2500,
                messages=[{"role": "user", "content": prompt}],
            )
            translation = resp.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(500, _safe_err(exc, "Translation")) from exc

    if not translation:
        raise HTTPException(500, "AI returned empty translation — check your API key in Settings")
    return {"translation": translation, "detected_lang": "auto"}

@router.post("/{email_id}/analyze-attachments")
async def analyze_attachments(email_id: str, request: Request):
    """Detect attachment references in the email body and extract structured insights.

    Finds attachment filenames mentioned in the email body/subject, then uses AI
    to extract key data points (amounts, dates, parties, deadlines) from context.
    """
    import re as _re
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    body = (email.body or "")[:4000]
    subject = email.subject or ""

    # Extract likely attachment filenames from body
    # Common patterns: .pdf, .docx, .xlsx, .pptx, .csv, .png, .jpg
    file_pattern = _re.compile(
        r'\b[\w\s\-\.]{1,60}\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|jpg|jpeg|png|gif)\b',
        _re.IGNORECASE
    )
    filenames = list(set(m.group().strip() for m in file_pattern.finditer(f"{subject} {body}")))[:10]

    if not filenames and not any(kw in body.lower() for kw in ['attach', 'enclose', 'see below', 'herewith']):
        return {"attachments": [], "insights": [], "has_attachments": False}

    prompt = f"""Analyze this email and its referenced attachments.

Subject: {subject}
Email body:
{body[:2000]}

Detected attachment names: {', '.join(filenames) if filenames else 'unspecified attachments'}

Extract key information. Return JSON:
{{
  "attachments": [
    {{"filename": "file.pdf", "type": "invoice|contract|report|proposal|receipt|other", "summary": "one sentence"}}
  ],
  "insights": [
    {{"key": "amount|deadline|party|action", "value": "extracted value", "label": "display label"}}
  ],
  "has_attachments": true
}}

Focus on: amounts/prices, deadlines/dates, parties/companies, required actions.
Return ONLY valid JSON."""

    ant = getattr(advisor.ai, "_anthropic", None)
    import json as _json, re as _re2
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=800,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=800,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        text = _re2.sub(r'^```[a-z]*\n?', '', text).rstrip('`').strip()
        s, e = text.find("{"), text.rfind("}") + 1
        data = _json.loads(text[s:e]) if s >= 0 else {}
    except Exception as exc:
        raise HTTPException(500, _safe_err(exc, "Attachment analysis")) from exc

    return {
        "attachments": data.get("attachments", []),
        "insights": data.get("insights", []),
        "has_attachments": bool(data.get("has_attachments") or filenames),
        "detected_filenames": filenames,
    }

@router.post("/{email_id}/extract-financials")
async def extract_financials(email_id: str, request: Request):
    """Extract financial data (amounts, dates, vendors, parties) from an email for spreadsheet export."""
    import re as _re, json as _json
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    body = _re.sub(r'<[^>]+>', ' ', (email.body or ""))[:3000]
    subject = email.subject or ""

    prompt = f"""Extract financial data from this email for a spreadsheet.

Subject: {subject}
From: {email.sender}
Date: {email.date}
Body:
{body}

Return ONLY valid JSON:
{{
  "type": "invoice|contract|receipt|proposal|other",
  "vendor": "company or person name",
  "amount": "numeric amount with currency, e.g. $1,500.00",
  "currency": "USD/CAD/EUR etc",
  "date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or null",
  "description": "what this is for",
  "reference": "invoice number, PO number, contract ID",
  "parties": ["party 1", "party 2"],
  "key_terms": ["term 1", "term 2"]
}}
If a field is not found, use null."""

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        import re as _re2
        text = _re2.sub(r'^```[a-z]*\n?', '', text).rstrip('`').strip()
        s, e = text.find("{"), text.rfind("}") + 1
        data = _json.loads(text[s:e]) if s >= 0 else {}
    except Exception as exc:
        raise HTTPException(500, _safe_err(exc, "Financial extraction"))

    # Add email context
    data["email_id"] = email_id
    data["email_subject"] = subject
    data["email_sender"] = email.sender
    data["email_date"] = email.date
    return data
