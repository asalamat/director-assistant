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

from cachetools import TTLCache

router = APIRouter(prefix="/api/emails", tags=["emails"])

_REC_COOLDOWN = 60.0  # seconds between AI calls for the same email
# TTLCache auto-evicts entries after _REC_COOLDOWN seconds and caps size at 500
_rec_cache: TTLCache = TTLCache(maxsize=500, ttl=_REC_COOLDOWN)


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
    only_unread: bool = Query(False),
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
            account_id=account_id, only_unread=only_unread,
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

    # Return cached result if within cooldown window (TTLCache auto-evicts after _REC_COOLDOWN)
    cached_rec = _rec_cache.get(email_id)
    if cached_rec is not None:
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


@router.get("/{email_id}/category")
async def get_email_category(request: Request, email_id: str):
    cache: EmailCache = request.app.state.cache
    cat = cache.get_category(email_id)
    return {"email_id": email_id, "category": cat}


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


@router.post("/{email_id}/classify")
async def classify_email(request: Request, email_id: str):
    cache: EmailCache = request.app.state.cache
    classifier = request.app.state.classifier
    email = cache.get(email_id)
    if not email:
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


@router.delete("/{email_id}")
async def delete_email(request: Request, email_id: str):
    cache: EmailCache = request.app.state.cache
    rag: RAGEngine = request.app.state.rag
    found = cache.delete_email(email_id)
    rag.remove_email(email_id)
    if not found:
        raise HTTPException(404, "Email not found")
