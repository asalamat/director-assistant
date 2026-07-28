"""Email AI analysis endpoints — translate, attachment insights, financial extraction."""
import logging
from fastapi import APIRouter, HTTPException, Request

from services.email_cache import EmailCache

router = APIRouter(prefix="/api/emails", tags=["email-ai-analyze"])
_log = logging.getLogger(__name__)


def _safe_err(e: Exception, label: str = "Operation") -> str:
    """Log the real error server-side; return a generic message for the client."""
    _log.error("%s failed: %s", label, e, exc_info=True)
    return f"{label} failed ({type(e).__name__})"


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
