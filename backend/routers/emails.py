from time import monotonic
from fastapi import APIRouter, HTTPException, Query, Request
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
        rag_results = rag.semantic_search(q, n=limit)
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

    similar = await rag.get_similar_emails(email, n=5)
    rec = await advisor.get_recommendation(email, similar)
    now2 = monotonic()
    _rec_cache[email_id] = (now2, rec)
    # Prune entries that have expired so the dict doesn't grow unbounded
    expired = [k for k, (ts, _) in _rec_cache.items() if now2 - ts >= _REC_COOLDOWN]
    for k in expired:
        _rec_cache.pop(k, None)
    return rec


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
    return {"deleted": email_id}
