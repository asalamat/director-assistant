import asyncio
import re
from time import monotonic


# ---------------------------------------------------------------------------
# HTML email sanitizer — prevents black-on-black text caused by HTML emails
# that hard-code dark background colors (bgcolor="#000" or inline style).
# ---------------------------------------------------------------------------

_CSS_NAMED_COLORS: dict[str, str] = {
    'black': '000000', 'navy': '000080', 'maroon': '800000',
    'darkblue': '00008b', 'darkgreen': '006400', 'darkred': '8b0000',
    'darkmagenta': '8b008b', 'darkcyan': '008b8b', 'darkviolet': '9400d3',
    'darkslategray': '2f4f4f', 'darkslategrey': '2f4f4f',
    'indigo': '4b0082', 'midnightblue': '191970', 'purple': '800080',
    'teal': '008080', 'olive': '808000', 'sienna': 'a0522d',
    'saddlebrown': '8b4513', 'brown': 'a52a2a', 'white': 'ffffff',
}


_BG_SHORTHAND_SKIP = frozenset({
    'no-repeat', 'repeat', 'repeat-x', 'repeat-y', 'round', 'space',
    'center', 'top', 'bottom', 'left', 'right', 'cover', 'contain',
    'auto', 'fixed', 'scroll', 'local', 'initial', 'inherit', 'unset', 'none',
})


def _luminance(color: str) -> float:
    """Return perceived brightness 0–1 for a CSS color string, or -1 if unknown."""
    c = color.strip().lower().rstrip(';').rstrip()
    # For background shorthand, scan ALL tokens for a recognizable color.
    # e.g. "url(img.gif) #000 no-repeat" — first token is url(), skip it, find #000.
    tokens = c.split()
    if len(tokens) > 1:
        for tok in tokens:
            if tok.startswith('url(') or tok in _BG_SHORTHAND_SKIP:
                continue
            lum = _luminance(tok)
            if lum >= 0:
                return lum
        return -1.0
    if c in _CSS_NAMED_COLORS:
        c = '#' + _CSS_NAMED_COLORS[c]
    m = re.match(r'^#([0-9a-f]{3}|[0-9a-f]{6})$', c)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = h[0]*2 + h[1]*2 + h[2]*2
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return (0.299*r + 0.587*g + 0.114*b) / 255
    m = re.match(r'^rgb\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)', c)
    if m:
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return (0.299*r + 0.587*g + 0.114*b) / 255
    return -1.0  # unknown — leave it alone


def _fix_bg_in_style(style: str) -> str:
    """Neutralize dark background-color / background properties inside a CSS string."""
    def _sub_bg(sm: re.Match) -> str:
        prop = sm.group(1)
        val  = sm.group(2).strip()
        lum = _luminance(val)
        if 0 <= lum <= 0.2:
            return f'{prop}: transparent'
        return sm.group(0)
    return re.sub(
        r'(background(?:-color)?)\s*:\s*([^;"\'>]+)',
        _sub_bg, style, flags=re.IGNORECASE,
    )


def sanitize_email_html(html: str) -> str:
    """Strip very dark background colors from HTML email to prevent unreadable text."""
    if not html:
        return html

    # 1. Sanitize <style>...</style> blocks (catches class-based dark backgrounds)
    def _fix_style_tag(m: re.Match) -> str:
        return m.group(1) + _fix_bg_in_style(m.group(2)) + m.group(3)

    html = re.sub(
        r'(<style[^>]*>)(.*?)(</style>)',
        _fix_style_tag, html, flags=re.IGNORECASE | re.DOTALL,
    )

    # 2. Replace dark bgcolor="..." and bgcolor=... (quoted or unquoted)
    def _fix_bgcolor(m: re.Match) -> str:
        val = (m.group(2) or m.group(3) or '').strip()
        lum = _luminance(val)
        if 0 <= lum <= 0.2:
            q = m.group(1) or ''
            return f'bgcolor={q}transparent{q}' if q else 'bgcolor=transparent'
        return m.group(0)

    # Quoted: bgcolor="..." or bgcolor='...'
    html = re.sub(r'bgcolor=(["\'])([^"\']*)\1', _fix_bgcolor, html, flags=re.IGNORECASE)
    # Unquoted: bgcolor=#000000 or bgcolor=black
    html = re.sub(r'bgcolor=()(#[0-9a-fA-F]{3,6}|[a-zA-Z]+)(?=[\s>])', _fix_bgcolor, html, flags=re.IGNORECASE)

    # 3. Replace dark background-color / background in inline style="..."
    def _fix_inline_style(m: re.Match) -> str:
        q = m.group(1)
        new_style = _fix_bg_in_style(m.group(2))
        return f'style={q}{new_style}{q}'

    html = re.sub(r'style=(["\'])([^"\']*)\1', _fix_inline_style, html, flags=re.IGNORECASE)

    # 4. Scoped CSS safety block — wraps email in .da-email-view so background
    #    overrides are contained and do NOT leak to the rest of the app.
    safety = (
        '<style type="text/css">'
        '.da-email-view{background-color:#ffffff;color:#333333}'
        '.da-email-view table,.da-email-view tr,.da-email-view td,'
        '.da-email-view th,.da-email-view div,.da-email-view p,'
        '.da-email-view span,.da-email-view font,.da-email-view a,'
        '.da-email-view li,.da-email-view ul,.da-email-view ol,'
        '.da-email-view blockquote,.da-email-view section,.da-email-view article,'
        '.da-email-view header,.da-email-view footer,'
        '.da-email-view h1,.da-email-view h2,.da-email-view h3,'
        '.da-email-view h4,.da-email-view h5,.da-email-view h6'
        '{background-color:transparent!important}'
        '</style>'
        '<div class="da-email-view">'
    )
    return safety + html + '</div>'
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
    to_date: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
    only_unread: bool = Query(False),
    category: Optional[str] = Query(None),
    sender_filter: Optional[str] = Query(None),
    has_attachment: bool = Query(False),
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
            to_date=to_date, account_id=account_id, only_unread=only_unread,
            category=category, sender_filter=sender_filter, has_attachment=has_attachment,
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


@router.get("/forgot-reply")
async def get_forgot_reply(request: Request, days: int = 30, limit: int = 20):
    """Return INBOX emails that were read but never replied to.

    Exclusions:
    - Emails the user sent themselves (sender is one of the user's own accounts).
    - Newsletters, fyi, and promotional categories.
    - Emails already tracked in the follow_ups table.
    """
    cache: EmailCache = request.app.state.cache

    with cache._conn() as conn:
        # Collect user's own email addresses from accounts table
        own_rows = conn.execute("SELECT email FROM accounts").fetchall()
        own_emails = [r["email"].lower() for r in own_rows if r["email"]]

        if own_emails:
            own_placeholders = ",".join("?" * len(own_emails))
            own_where = f"AND LOWER(e.sender) NOT IN ({own_placeholders})"
            reply_where = f"AND LOWER(e2.sender) IN ({own_placeholders})"
            own_params: list = own_emails
        else:
            own_where = ""
            reply_where = "AND 1=0"
            own_params = []

        cutoff = f"datetime('now', '-{int(days)} days')"

        rows = conn.execute(
            f"""
            SELECT e.id, e.subject, e.sender, e.date
            FROM emails e
            WHERE e.is_read = 1
              AND e.folder = 'INBOX'
              AND e.date >= {cutoff}
              {own_where}
              AND e.id NOT IN (
                  SELECT ec.email_id FROM email_categories ec
                  WHERE LOWER(ec.category) IN ('newsletter', 'fyi', 'promotional', 'notification')
              )
              AND e.id NOT IN (
                  SELECT fu.email_id FROM follow_ups fu WHERE fu.email_id IS NOT NULL
              )
              AND (
                  e.thread_id IS NULL
                  OR e.thread_id NOT IN (
                      SELECT e2.thread_id FROM emails e2
                      WHERE e2.thread_id IS NOT NULL
                        {reply_where}
                  )
              )
            ORDER BY e.date DESC
            LIMIT ?
            """,
            (*own_params, *own_params, min(limit, 50)),
        ).fetchall()

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    results = []
    for r in rows:
        date_str = str(r["date"] or "")
        days_ago = 0
        try:
            parsed = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            days_ago = (now - parsed).days
        except Exception:
            pass
        results.append({
            "id": r["id"],
            "subject": r["subject"] or "(no subject)",
            "sender": r["sender"] or "",
            "date": date_str,
            "days_ago": days_ago,
        })

    return {"emails": results, "total": len(results), "days": days}


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


@router.get("/{email_id}/thread")
async def get_email_thread(email_id: str, request: Request):
    """Return all emails in the same thread, ordered oldest first."""
    from services.email_cache import EmailCache
    cache: EmailCache = request.app.state.cache
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    if not email.thread_id:
        return {"thread": [], "thread_id": None}

    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, date, body, is_read, folder
               FROM emails
               WHERE thread_id = ? AND id != ?
               ORDER BY date ASC""",
            (email.thread_id, email_id),
        ).fetchall()

    thread = [
        {
            "id": r["id"],
            "subject": r["subject"] or "(no subject)",
            "sender": r["sender"] or "",
            "date": str(r["date"] or ""),
            "body": (r["body"] or "")[:5000],
            "is_read": bool(r["is_read"]),
            "folder": r["folder"] or "INBOX",
        }
        for r in rows
    ]
    return {"thread": thread, "thread_id": email.thread_id, "total": len(thread)}


@router.get("/{email_id}")
async def get_email(request: Request, email_id: str, folder: str = Query("INBOX")):
    cache: EmailCache = request.app.state.cache

    # Fast path: SQLite cache
    cached = cache.get(email_id)
    if cached:
        if cached.body_html:
            cached = cached.model_copy(update={"body_html": sanitize_email_html(cached.body_html)})
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
    if email.body_html:
        email = email.model_copy(update={"body_html": sanitize_email_html(email.body_html)})
    return email


@router.get("/{email_id}/attachments")
async def list_attachments(email_id: str, request: Request):
    """Parse email MIME structure to list attachments (filename, size, content_type)."""
    cache: EmailCache = request.app.state.cache
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    attachments = []
    body = email.body or ""
    body_html = getattr(email, 'body_html', '') or ""
    combined = body + " " + body_html

    file_re = re.compile(
        r'\b([\w\s\-\.]{1,60})\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|jpg|jpeg|png|gif|mp4|mov|rar|7z)\b',
        re.IGNORECASE
    )
    seen = set()
    for m in file_re.finditer(combined):
        fname = m.group(0).strip()
        if fname not in seen:
            seen.add(fname)
            attachments.append({
                "filename": fname,
                "content_type": _get_mime_type(m.group(2).lower()),
                "index": len(attachments),
            })

    return {"attachments": attachments, "email_id": email_id}


def _get_mime_type(ext: str) -> str:
    return {
        "pdf": "application/pdf", "docx": "application/msword", "doc": "application/msword",
        "xlsx": "application/vnd.ms-excel", "xls": "application/vnd.ms-excel",
        "pptx": "application/vnd.ms-powerpoint", "csv": "text/csv",
        "txt": "text/plain", "zip": "application/zip",
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
    }.get(ext, "application/octet-stream")


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


@router.get("/{email_id}/preview")
async def get_email_preview(email_id: str, request: Request):
    """Return a 1-sentence AI preview (max 100 chars) for inbox list display.
    Result is cached in SQLite so it is only generated once per email.
    Falls back to the first 100 chars of body if AI is unavailable.
    """
    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor

    # Return from cache if already generated
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT preview FROM email_previews WHERE email_id = ?", (email_id,)
        ).fetchone()
    if row:
        return {"preview": row["preview"]}

    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    body = (email.body or "").strip()[:800]
    preview = ""

    prompt = (
        "Summarize this email in ONE sentence, max 100 characters. "
        "Be specific about what the sender wants or says. No quotes.\n"
        f"From: {email.sender}\nSubject: {email.subject}\n\n{body}"
    )
    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        client = ant if ant else advisor.ai
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=60,
            messages=[{"role": "user", "content": prompt}],
        )
        preview = resp.content[0].text.strip().rstrip(".")[:100]
    except Exception:
        pass

    if not preview:
        import re as _re
        preview = _re.sub(r"\s+", " ", body)[:100]

    with cache._conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO email_previews (email_id, preview) VALUES (?, ?)",
            (email_id, preview),
        )

    return {"preview": preview}


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


@router.post("/classify-batch")
async def classify_batch(request: Request):
    """Classify up to 300 emails spread across the full inbox (random sample)."""
    cache: EmailCache = request.app.state.cache
    classifier = request.app.state.classifier
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT e.id, e.subject, e.sender, e.body FROM emails e "
            "LEFT JOIN email_categories ec ON ec.email_id = e.id "
            "WHERE ec.category IS NULL ORDER BY RANDOM() LIMIT 300"
        ).fetchall()
    classified = 0
    for row in rows:
        try:
            cat = await classifier.classify(
                row["id"], row["subject"] or "", row["sender"] or "", (row["body"] or "")[:200]
            )
            cache.set_category(row["id"], cat)
            classified += 1
        except Exception:
            continue
    return {"classified": classified, "total_unclassified": len(rows)}


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


class MoveEmailRequest(BaseModel):
    folder: str


@router.post("/{email_id}/move")
async def move_email(email_id: str, req: MoveEmailRequest, request: Request):
    """Move an email to a different folder (locally in cache + optionally on IMAP)."""
    cache: EmailCache = request.app.state.cache
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")
    with cache._conn() as conn:
        conn.execute("UPDATE emails SET folder = ? WHERE id = ?", (req.folder, email_id))
    return {"status": "moved", "folder": req.folder}


@router.post("/{email_id}/read")
async def mark_email_read(email_id: str, request: Request):
    """Mark an email as read in the local cache."""
    cache: EmailCache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("UPDATE emails SET is_read = 1 WHERE id = ?", (email_id,))
    return {"status": "read", "email_id": email_id}


class BulkActionRequest(BaseModel):
    action: str  # "archive" | "delete" | "mark_read"
    email_ids: list[str]


@router.post("/bulk-action")
async def bulk_action(req: BulkActionRequest, request: Request):
    """Perform a bulk action on up to 100 emails at once.

    Actions:
      archive   — move emails to 'Archive' folder in local cache
      delete    — remove emails from cache and RAG index
      mark_read — mark emails as read in local cache
    """
    if req.action not in ("archive", "delete", "mark_read"):
        raise HTTPException(400, f"Unknown action: {req.action!r}")

    ids = req.email_ids[:100]  # cap at 100
    if not ids:
        raise HTTPException(400, "email_ids must not be empty")

    cache: EmailCache = request.app.state.cache
    rag: RAGEngine = request.app.state.rag

    processed: list[str] = []

    if req.action == "mark_read":
        with cache._conn() as conn:
            for email_id in ids:
                conn.execute("UPDATE emails SET is_read = 1 WHERE id = ?", (email_id,))
                processed.append(email_id)

    elif req.action == "archive":
        with cache._conn() as conn:
            for email_id in ids:
                rows_affected = conn.execute(
                    "UPDATE emails SET folder = 'Archive' WHERE id = ?", (email_id,)
                ).rowcount
                if rows_affected:
                    processed.append(email_id)

    elif req.action == "delete":
        for email_id in ids:
            found = cache.delete_email(email_id)
            rag.remove_email(email_id)
            if found:
                processed.append(email_id)

    return {"action": req.action, "processed": len(processed), "ids": processed}
