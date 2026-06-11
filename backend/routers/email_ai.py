"""Email AI endpoints — generative features (smart draft, translate, search, etc.)."""
import asyncio
import json as _json
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List

from models import SearchRequest
from services.email_cache import EmailCache
from services.rag_engine import RAGEngine

router = APIRouter(prefix="/api/emails", tags=["email-ai"])


class CreateEventRequest(BaseModel):
    title: str
    start_datetime: str   # ISO: "2026-06-02T10:00:00"
    end_datetime: str
    attendees: list[str] = []
    description: str = ""



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

    thread_ctx = "\n\n".join(thread_history) or "No prior messages."
    doc_ctx    = "\n\n".join(related_docs) or "No related documents."
    style_ctx  = style_examples or "No sent mail available for style matching."

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
    return {
        "summary": data.get("summary", ""),
        "key_points": data.get("key_points", []),
        "outcome": data.get("outcome", ""),
        "participants": data.get("participants", []),
        "message_count": len(thread_msgs),
    }

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
    async with ai.messages.stream(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        system="Output ONLY valid JSON. No markdown, no explanation.",
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        async for chunk in stream.text_stream:
            raw += chunk
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
        raise HTTPException(500, str(e))

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
    drafts = []
    for email_id in email_ids:
        email = cache.get(email_id)
        if not email:
            continue
        body = (email.body or "")[:1500]
        subject = f"Re: {email.subject}" if not (email.subject or "").lower().startswith("re:") else email.subject
        prompt = (f"Write a brief professional reply to this email.\n"
                  f"From: {email.sender}\nSubject: {email.subject}\n\n{body}\n\n"
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
            drafts.append({"email_id": email_id, "subject": subject or "", "to": email.sender or "", "draft": f"Error: {e}"})
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
        raise HTTPException(500, str(e))
    return {"result": result}

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
        raise HTTPException(500, f"Translation failed: {exc}") from exc

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
        raise HTTPException(500, f"Analysis failed: {exc}") from exc

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
        raise HTTPException(500, str(exc))

    # Add email context
    data["email_id"] = email_id
    data["email_subject"] = subject
    data["email_sender"] = email.sender
    data["email_date"] = email.date
    return data