import asyncio
from time import monotonic
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional
from models import EmailListResponse, EmailSummary, AIRecommendation, SearchRequest
from services.email_provider import build_provider
from services.rag_engine import RAGEngine
from services.ai_advisor import AIAdvisor
from services.email_cache import EmailCache
from routers.connection import load_config

router = APIRouter(prefix="/api/emails", tags=["emails"])

_REC_COOLDOWN = 60.0  # seconds between AI calls for the same email
_rec_cache: dict[str, tuple[float, AIRecommendation]] = {}


@router.get("/", response_model=EmailListResponse)
async def list_emails(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    folder: str = Query("INBOX"),
    q: Optional[str] = Query(None),
    sort_by: str = Query("date", pattern="^(date|sender|subject)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    from_date: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
):
    cache: EmailCache = request.app.state.cache
    rag: RAGEngine = request.app.state.rag

    # Semantic / full-text search
    if q:
        rag_results = [r for r in rag.semantic_search(q, n=limit)
                       if r.get("source_type") != "document"]
        if rag_results:
            summaries = [
                EmailSummary(
                    id=r["email_id"],
                    subject=r["subject"],
                    sender=r["sender"],
                    date=r["date"],
                    preview=r["text"][:160],
                    is_read=True,
                )
                for r in rag_results
            ]
            return EmailListResponse(emails=summaries, total=len(summaries), has_more=False)
        summaries = cache.fts_search(q, limit=limit)
        return EmailListResponse(emails=summaries, total=len(summaries), has_more=False)

    # Fast path: read from SQLite cache with sort + date filter
    cached_count = cache.count()
    if cached_count > 0:
        summaries, total = cache.list_emails(
            folder=folder, skip=skip, limit=limit,
            sort_by=sort_by, sort_order=sort_order, from_date=from_date,
            account_id=account_id,
        )
        return EmailListResponse(
            emails=summaries,
            total=total,
            has_more=(skip + limit) < total,
        )

    # Cold path: fetch from IMAP (before any ingestion)
    cfg = load_config()
    if not cfg:
        raise HTTPException(400, "Not connected to email provider")
    provider = build_provider(cfg)

    emails = []
    total = 0
    try:
        import itertools
        for i, (email, t) in enumerate(itertools.islice(provider.fetch_all(folder=folder), skip + limit)):
            total = max(total, t)
            if i >= skip:
                preview = (email.body or "")[:160].replace("\n", " ")
                emails.append(EmailSummary(
                    id=email.id,
                    subject=email.subject or "(no subject)",
                    sender=email.sender or "",
                    date=str(email.date) if email.date else None,
                    preview=preview,
                    is_read=email.is_read,
                ))
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch emails: {e}")

    return EmailListResponse(emails=emails, total=total, has_more=(skip + limit) < total)


@router.get("/folders")
async def list_folders(request: Request):
    """Return {folder_name: email_count} for all folders in the cache."""
    cache: EmailCache = request.app.state.cache
    return cache.folder_breakdown()


@router.get("/unread-count")
async def unread_count(request: Request):
    cache: EmailCache = request.app.state.cache
    return {"unread": cache.count_unread()}


@router.get("/followup-due")
async def list_followup_due(
    request: Request,
    as_of: Optional[str] = Query(None, description="ISO datetime cutoff (defaults to now)"),
):
    """Return emails with followup_remind_at <= now (or as_of if provided)."""
    cache: EmailCache = request.app.state.cache
    emails = cache.list_followup_due(as_of=as_of)
    return {"emails": emails, "total": len(emails)}


@router.get("/threads")
async def list_threads(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    folder: str = Query("INBOX"),
    account_id: Optional[int] = Query(None),
):
    """Return emails grouped by thread_id (Message-ID / In-Reply-To chain)."""
    cache: EmailCache = request.app.state.cache
    loop = asyncio.get_event_loop()
    threads = await loop.run_in_executor(
        None, lambda: cache.list_threads(folder=folder, skip=skip, limit=limit, account_id=account_id)
    )
    return {"threads": threads, "total": len(threads)}


@router.get("/{email_id}")
async def get_email(request: Request, email_id: str, folder: str = Query("INBOX")):
    cache: EmailCache = request.app.state.cache

    # Fast path: SQLite cache
    cached = cache.get(email_id)
    if cached:
        return cached

    # Slow path: fetch from IMAP and cache for next time
    cfg = load_config()
    if not cfg:
        raise HTTPException(400, "Not connected")
    provider = build_provider(cfg)
    try:
        email = provider.fetch_one(email_id, folder)
    except Exception as e:
        raise HTTPException(500, f"Fetch error: {e}")
    if not email:
        raise HTTPException(404, "Email not found")

    cache.save(email)
    return email


@router.get("/{email_id}/recommend", response_model=AIRecommendation)
async def recommend(request: Request, email_id: str, folder: str = Query("INBOX")):
    rag: RAGEngine = request.app.state.rag
    advisor: AIAdvisor = request.app.state.advisor
    cache: EmailCache = request.app.state.cache

    # Return cached result if within cooldown window
    now = monotonic()
    if email_id in _rec_cache:
        ts, cached_rec = _rec_cache[email_id]
        if now - ts < _REC_COOLDOWN:
            return cached_rec

    # Fetch from cache first, fall back to IMAP
    email = cache.get(email_id)
    if not email:
        cfg = load_config()
        if not cfg:
            raise HTTPException(400, "Not connected")
        provider = build_provider(cfg)
        try:
            email = provider.fetch_one(email_id, folder)
        except Exception as e:
            raise HTTPException(500, f"Fetch error: {e}")
        if not email:
            raise HTTPException(404, "Email not found")
        cache.save(email)

    # Ensure this email is indexed (idempotent)
    if rag.ingest_email(email):
        rag.flush_bm25()

    # Fetch prior thread messages for context (oldest-first, capped at 3 × 800 chars)
    thread_history: list[dict] = []
    if email.thread_id:
        with cache._conn() as conn:
            t_rows = conn.execute(
                """SELECT subject, sender, date, body FROM emails
                   WHERE thread_id = ? AND id != ?
                   ORDER BY date ASC LIMIT 3""",
                (email.thread_id, email_id),
            ).fetchall()
            thread_history = [
                {"subject": r["subject"] or "", "sender": r["sender"] or "",
                 "date": r["date"] or "", "text": (r["body"] or "")[:800]}
                for r in t_rows
            ]

    similar = await rag.get_similar_emails(email, n=5)
    doc_query = f"{email.subject} {(email.body or '')[:300]}"
    related_docs = [r for r in rag.semantic_search(doc_query, n=3)
                    if r.get("source_type") == "document"]
    rec = await advisor.get_recommendation(email, similar, related_docs, thread_history)
    now2 = monotonic()
    _rec_cache[email_id] = (now2, rec)
    # Evict expired entries; also cap total size to prevent unbounded growth
    expired = [k for k, (ts, _) in _rec_cache.items() if now2 - ts >= _REC_COOLDOWN]
    for k in expired:
        _rec_cache.pop(k, None)
    if len(_rec_cache) > 500:
        oldest = sorted(_rec_cache, key=lambda k: _rec_cache[k][0])[:100]
        for k in oldest:
            _rec_cache.pop(k, None)
    return rec


@router.post("/{email_id}/followup-remind")
async def set_followup_remind(request: Request, email_id: str, body: dict):
    """Set or clear followup_remind_at for an email. Pass remind_at='' to clear."""
    remind_at = (body.get("remind_at") or "").strip()
    cache: EmailCache = request.app.state.cache
    loop = asyncio.get_event_loop()
    found = await loop.run_in_executor(None, cache.set_followup_remind_at, email_id, remind_at)
    if not found:
        raise HTTPException(404, "Email not found")
    return {"email_id": email_id, "followup_remind_at": remind_at or None}


@router.post("/import-by-subject")
async def import_by_subject(request: Request, body: dict):
    """Search all IMAP folders for emails matching a subject string and ingest them."""
    subject = (body.get("subject") or "").strip()
    if not subject:
        raise HTTPException(400, "subject is required")

    cache: EmailCache = request.app.state.cache
    rag: RAGEngine = request.app.state.rag

    from services.email_provider import build_provider, IMAPProvider
    from routers.connection import load_config

    all_accounts = cache.list_accounts()
    providers = []
    if all_accounts:
        for acc in all_accounts:
            try:
                providers.append((acc.id, build_provider(acc.to_connection_config())))
            except Exception:
                pass
    else:
        cfg = load_config()
        if cfg:
            providers = [(0, build_provider(cfg))]

    if not providers:
        raise HTTPException(400, "Not connected to any email account")

    imported = []
    errors = []
    import asyncio
    loop = asyncio.get_event_loop()

    def do_search(account_id, provider):
        found = []
        folders = provider.get_ingest_folders() if hasattr(provider, 'get_ingest_folders') else ["INBOX"]
        for folder in folders:
            try:
                if isinstance(provider, IMAPProvider):
                    for email_obj, _ in provider.search_by_subject(subject, folder=folder):
                        if account_id:
                            email_obj._server_id = email_obj.id
                            email_obj.id = f"a{account_id}_{email_obj.id}"
                        cache.save(email_obj, account_id=account_id)
                        rag.ingest_email(email_obj)
                        found.append({"id": email_obj.id, "subject": email_obj.subject,
                                      "sender": email_obj.sender, "folder": folder})
            except Exception as e:
                errors.append(f"folder={folder}: {e}")
        return found

    for account_id, provider in providers:
        try:
            results = await loop.run_in_executor(None, do_search, account_id, provider)
            imported.extend(results)
        except Exception as e:
            errors.append(str(e))

    if imported:
        rag.flush_bm25()

    return {"imported": imported, "count": len(imported), "errors": errors}


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


@router.post("/{email_id}/classify")
async def classify_email(request: Request, email_id: str):
    cache: EmailCache = request.app.state.cache
    classifier = request.app.state.classifier
    email = cache.get(email_id)
    if not email:
        from fastapi import HTTPException
        raise HTTPException(404, "Email not found in cache")
    cat = await classifier.classify(
        email_id, email.subject or "", email.sender or "", (email.body or "")[:200]
    )
    cache.set_category(email_id, cat)
    return {"email_id": email_id, "category": cat}


@router.post("/{email_id}/auto-label")
async def auto_label(email_id: str, request: Request):
    """AI-classify this email and persist the label."""
    cache: EmailCache = request.app.state.cache
    classifier = request.app.state.classifier
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")
    cat = await classifier.classify(
        email_id, email.subject or "", email.sender or "", (email.body or "")[:200]
    )
    cache.set_category(email_id, cat)
    return {"email_id": email_id, "label": cat}


@router.get("/{email_id}/category")
async def get_email_category(request: Request, email_id: str):
    cache: EmailCache = request.app.state.cache
    cat = cache.get_category(email_id)
    return {"email_id": email_id, "category": cat}


@router.delete("/{email_id}")
async def delete_email(request: Request, email_id: str):
    cache: EmailCache = request.app.state.cache
    rag: RAGEngine = request.app.state.rag
    found = cache.delete_email(email_id)
    rag.remove_email(email_id)
    if not found:
        raise HTTPException(404, "Email not found")


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


@router.get("/{email_id}/unsubscribe-url")
async def get_unsubscribe_url(email_id: str, request: Request):
    """Return the unsubscribe URL found in the email, or null."""
    cache: EmailCache = request.app.state.cache
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")
    from services.unsubscribe import extract_unsubscribe_url
    url = extract_unsubscribe_url(email)
    return {"url": url}


@router.get("/{email_id}/one-line")
async def one_line_summary(email_id: str, request: Request):
    """Generate a single-sentence AI summary for inbox preview."""
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")
    body = (email.body or "")[:800]
    prompt = (
        f"Summarize this email in ONE sentence (max 15 words). Be specific, not generic.\n"
        f"From: {email.sender}\nSubject: {email.subject}\n\n{body}\n\n"
        "Return ONLY the one-sentence summary, no quotes, no punctuation at end."
    )
    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=60,
                messages=[{"role": "user", "content": prompt}])
            summary = resp.content[0].text.strip().rstrip(".")
        else:
            resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=60,
                messages=[{"role": "user", "content": prompt}])
            summary = resp.content[0].text.strip().rstrip(".")
    except Exception:
        summary = ""
    return {"summary": summary}


class CreateEventRequest(BaseModel):
    title: str
    start_datetime: str   # ISO: "2026-06-02T10:00:00"
    end_datetime: str
    attendees: list[str] = []
    description: str = ""


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
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                "https://graph.microsoft.com/v1.0/me/calendar/events",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
            )
        if r.status_code == 201:
            data = r.json()
            return {"status": "created", "event_id": data.get("id", ""), "web_link": data.get("webLink", "")}
        raise HTTPException(r.status_code, r.json().get("error", {}).get("message", "Graph API error"))
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
    import json as _json
    body_bytes = await request.body()
    try:
        target_lang = _json.loads(body_bytes).get("target_lang", "English")
    except Exception:
        target_lang = "English"
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")
    body = (email.body or "")[:3000]
    if not body.strip():
        return {"translation": "", "detected_lang": "unknown"}
    prompt = (f"Translate the following email to {target_lang}.\nFirst detect the source language.\n\n{body}\n\n"
              f'Return JSON: {{"detected_lang": "source language", "translation": "translated text"}}')
    ant = getattr(advisor.ai, "_anthropic", None)
    import json as _json2
    try:
        if ant:
            resp = await ant.messages.create(model="claude-haiku-4-5-20251001", max_tokens=1500,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=1500,
                messages=[{"role": "user", "content": prompt}])
            text = resp.content[0].text.strip()
        s, e = text.find("{"), text.rfind("}") + 1
        data = _json2.loads(text[s:e]) if s >= 0 else {}
    except Exception:
        data = {}
    return {"translation": data.get("translation", ""), "detected_lang": data.get("detected_lang", "unknown")}
