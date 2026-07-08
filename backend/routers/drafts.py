import json as _json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/drafts", tags=["drafts"])

_log = logging.getLogger(__name__)


def _safe_err(e: Exception, label: str = "Operation") -> str:
    """Log the real error server-side; return a generic message for the client."""
    _log.error("%s failed: %s", label, e, exc_info=True)
    return f"{label} failed ({type(e).__name__})"


def _load_style(cache, account_id: int = 0) -> Optional[dict]:
    """Return the cached writing-style row for an account, or None."""
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT style_json, sample_count, computed_at FROM writing_style_cache "
            "WHERE account_id = ? ORDER BY id DESC LIMIT 1",
            (account_id,),
        ).fetchone()
    if not row:
        return None
    try:
        style = _json.loads(row["style_json"])
    except Exception:
        style = {}
    return {
        "style": style,
        "sample_count": row["sample_count"],
        "computed_at": row["computed_at"],
    }


def _fetch_sent_bodies(cache, account_id: int, limit: int) -> list[str]:
    """Fetch the most recent sent-mail bodies, truncated to 500 chars each."""
    with cache._conn() as conn:
        if account_id:
            rows = conn.execute(
                "SELECT body FROM emails WHERE LOWER(folder) LIKE '%sent%' "
                "AND account_id = ? ORDER BY date DESC LIMIT ?",
                (account_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT body FROM emails WHERE LOWER(folder) LIKE '%sent%' "
                "ORDER BY date DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [(r["body"] or "")[:500] for r in rows if r["body"]]


class LearnStyleRequest(BaseModel):
    account_id: int = 0
    sample_count: int = 50


@router.post("/learn-style")
async def learn_style(req: LearnStyleRequest, request: Request):
    """Analyze recent sent mail to build/refresh the user's writing-style profile."""
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    account_id = max(0, int(req.account_id or 0))
    sample_count = max(5, min(int(req.sample_count or 50), 100))

    # Rate limit: reject a re-learn if the last one was under an hour ago.
    existing = _load_style(cache, account_id)
    if existing and existing.get("computed_at"):
        try:
            last = datetime.fromisoformat(existing["computed_at"].replace("Z", ""))
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - last < timedelta(hours=1):
                raise HTTPException(
                    429,
                    "Style was learned less than an hour ago — please wait before re-learning.",
                )
        except HTTPException:
            raise
        except Exception:
            pass

    sent_bodies = _fetch_sent_bodies(cache, account_id, sample_count)
    if not sent_bodies:
        raise HTTPException(400, "No sent emails found to learn from. Send a few emails first.")

    style = await advisor.extract_writing_style(sent_bodies)
    if not style:
        raise HTTPException(500, "Could not analyze writing style — check your AI provider in Settings.")

    used = len(sent_bodies)
    with cache._conn() as conn:
        conn.execute("DELETE FROM writing_style_cache WHERE account_id = ?", (account_id,))
        conn.execute(
            "INSERT INTO writing_style_cache (account_id, style_json, sample_count, computed_at) "
            "VALUES (?, ?, ?, datetime('now'))",
            (account_id, _json.dumps(style), used),
        )
    return {"style": style, "samples_used": used}


@router.get("/style-profile")
async def style_profile(request: Request, account_id: int = 0):
    """Return the stored writing-style profile for an account, if any."""
    cache = request.app.state.cache
    existing = _load_style(cache, max(0, int(account_id or 0)))
    if not existing:
        return {"style": None, "computed_at": None, "sample_count": 0}
    return {
        "style": existing["style"],
        "computed_at": existing["computed_at"],
        "sample_count": existing["sample_count"],
    }


class VoiceDraftRequest(BaseModel):
    email_id: str
    context: Optional[str] = None
    account_id: int = 0


@router.post("/voice-draft")
async def voice_draft(req: VoiceDraftRequest, request: Request):
    """Generate a reply draft in the user's learned writing voice."""
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    email = cache.get(req.email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    profile = _load_style(cache, max(0, int(req.account_id or 0)))
    style = (profile or {}).get("style") or {}
    style_applied = bool(style)

    style_block = ""
    if style:
        style_block = (
            "\nWRITE IN THE USER'S OWN VOICE. Match this learned style profile exactly:\n"
            f"- Formality: {style.get('formality', 'neutral')}\n"
            f"- Sentence length: {style.get('avg_sentence_length', 'medium')}\n"
            f"- Greeting style: {style.get('greeting_style', 'a natural greeting')}\n"
            f"- Closing style: {style.get('closing_style', 'a natural sign-off')}\n"
            f"- Signature name: {style.get('signature_name') or 'omit if unknown'}\n"
            f"- Punctuation habits: {style.get('punctuation', 'standard')}\n"
            f"- Emoji usage: {style.get('emoji_usage', 'none')}\n"
            f"- Vocabulary: {style.get('vocabulary', 'moderate')}\n"
            f"- Overall tone: {style.get('tone', 'professional')}\n"
        )

    extra_ctx = f"\nADDITIONAL INSTRUCTIONS FROM THE USER:\n{req.context[:500]}\n" if req.context else ""

    from routers.config import load_app_config as _load_cfg
    _persona = (_load_cfg().get("email_persona") or "").strip()
    persona_block = f"\nUSER PERSONA & TONE:\n{_persona}\n" if _persona else ""

    prompt = f"""You are ghostwriting a complete email reply on behalf of the recipient.

ORIGINAL EMAIL:
From: {email.sender}
Subject: {email.subject}
Date: {email.date}

{(email.body or '')[:3000]}
{persona_block}{style_block}{extra_ctx}
Write ONE complete email reply that addresses all points in the original email.
Include an appropriate greeting and a natural sign-off.
Return ONLY the email body text — no subject line, no JSON, no markdown."""

    ant = getattr(advisor.ai, "_anthropic", None)
    model = "claude-haiku-4-5-20251001" if advisor.ai._budget_mode else "claude-sonnet-4-6"
    try:
        if ant:
            resp = await ant.messages.create(
                model=model, max_tokens=1200,
                messages=[{"role": "user", "content": prompt}],
            )
        else:
            resp = await advisor.ai.messages.create(
                model=model, max_tokens=1200,
                messages=[{"role": "user", "content": prompt}],
            )
        draft = resp.content[0].text.strip()
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Voice draft generation"))

    subject = email.subject or ""
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    return {"draft": draft, "subject": subject, "to": email.sender, "style_applied": style_applied}


class DraftRequest(BaseModel):
    to: str
    subject: str
    body: str
    account_id: int = 0


@router.post("/save")
async def save_draft(req: DraftRequest, request: Request):
    cache = request.app.state.cache

    # Resolve provider
    from services.email_provider import build_provider
    if req.account_id:
        acc = cache.get_account(req.account_id)
        if not acc:
            raise HTTPException(404, "Account not found")
        cfg = acc.to_connection_config()
    else:
        from routers.connection import load_config
        cfg = load_config()
        if not cfg:
            raise HTTPException(400, "No account configured")

    try:
        provider = build_provider(cfg)
        ok = provider.save_draft(req.to, req.subject, req.body)
        if hasattr(provider, "disconnect"):
            try:
                provider.disconnect()
            except Exception:
                pass
        if not ok:
            raise HTTPException(500, "Failed to save draft")
        return {"status": "saved"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Draft save"))


class ReviewRequest(BaseModel):
    to: str
    subject: str
    body: str
    original_email_id: Optional[str] = None


@router.post("/review")
async def pre_send_review(req: ReviewRequest, request: Request):
    """AI review of a draft before sending: tone, unanswered questions, commitments."""
    if not req.body.strip():
        raise HTTPException(400, "Draft body is empty")

    advisor = request.app.state.advisor
    cache = request.app.state.cache

    original_ctx = ""
    if req.original_email_id:
        original = cache.get(req.original_email_id)
        if original:
            original_ctx = f"\nORIGINAL EMAIL (what you are replying to):\nFrom: {original.sender}\nSubject: {original.subject}\n\n{(original.body or '')[:2000]}"

    prompt = f"""Review this draft email before it is sent. Return a JSON object only — no prose, no markdown fences.

DRAFT:
To: {req.to}
Subject: {req.subject}

{req.body[:3000]}
{original_ctx}

Analyse the draft on four dimensions:
1. Tone — is it appropriate, professional, not passive-aggressive, not too abrupt?
2. Unanswered questions — does the original email (if provided) ask questions this draft ignores?
3. Commitments — what does the sender promise or commit to in this draft?
4. Suggestions — up to 3 brief, actionable improvements (omit if none needed)

Return this exact JSON (arrays may be empty):
{{
  "tone": "one-sentence tone description",
  "tone_label": "good" | "warning" | "issue",
  "unanswered_questions": ["question text", ...],
  "commitments": ["commitment text", ...],
  "suggestions": ["suggestion text", ...],
  "ready": true | false
}}

tone_label rules: "good" = professional and appropriate; "warning" = minor tone concerns; "issue" = aggressive, rude, or unclear.
ready = true when tone_label is "good" and unanswered_questions is empty."""

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Draft review"))

    s, e = text.find("{"), text.rfind("}") + 1
    try:
        data = _json.loads(text[s:e]) if s >= 0 else {}
    except Exception:
        data = {}

    return {
        "tone": data.get("tone", "Unable to assess"),
        "tone_label": data.get("tone_label", "warning"),
        "unanswered_questions": data.get("unanswered_questions", []),
        "commitments": data.get("commitments", []),
        "suggestions": data.get("suggestions", []),
        "ready": bool(data.get("ready", False)),
    }
