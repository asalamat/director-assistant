"""Email AI compose endpoints — smart draft, thread summary, tone, rewrite, bulk-draft."""
import json as _json
import logging
from enum import Enum
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.email_cache import EmailCache
from services.rag_engine import RAGEngine

router = APIRouter(prefix="/api/emails", tags=["email-ai-compose"])
_log = logging.getLogger(__name__)

# Cache thread summaries to avoid re-summarizing the same conversation.
_thread_summary_cache: dict[str, dict] = {}


def _safe_err(e: Exception, label: str = "Operation") -> str:
    """Log the real error server-side; return a generic message for the client."""
    _log.error("%s failed: %s", label, e, exc_info=True)
    return f"{label} failed ({type(e).__name__})"


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


@router.post("/bulk-draft")
async def bulk_draft(request: Request):
    """Generate smart draft replies for multiple emails at once."""
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


@router.post("/{email_id}/reply-templates")
async def get_reply_templates(email_id: str, request: Request):
    import re as _re
    cache = request.app.state.cache
    advisor = request.app.state.advisor
    rag = request.app.state.rag

    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    rag_results = rag.hybrid_search(email.sender or "", 5)
    context = "\n".join(r.get("text", "")[:300] for r in rag_results[:3])

    prompt = (
        "Generate 3 reply drafts for this email. Return a JSON array ONLY, no other text:\n"
        '[{"style":"brief","subject":"Re: SUBJECT","body":"..."},'
        '{"style":"professional","subject":"Re: SUBJECT","body":"..."},'
        '{"style":"detailed","subject":"Re: SUBJECT","body":"..."}]\n\n'
        f"Email from: {email.sender}\nSubject: {email.subject}\n"
        f"Body: {(email.body or '')[:1500]}\nSender context: {context[:400]}"
    ).replace("SUBJECT", (email.subject or "")[:80])

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        resp = await (ant or advisor.ai).messages.create(
            model="claude-sonnet-4-6", max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        m = _re.search(r"\[.*\]", text, _re.DOTALL)
        templates = _json.loads(m.group(0)) if m else []
    except Exception as e:
        raise HTTPException(500, _safe_err(e, "Reply templates"))
    return {"templates": templates}
