import json as _json
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


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
        raise HTTPException(500, str(e))


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
        raise HTTPException(500, str(e))

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
