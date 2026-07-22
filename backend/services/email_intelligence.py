"""AI intelligence helpers for email-ai endpoints.

Keeps email_ai.py thin by holding the AI-call logic for:
- score_draft         — rate a draft reply 1-100 with suggestions + strengths
- negotiation_radar   — extract price/deadline/commitment/concession/risk signals
- suggested_opener    — generate an opener from past sent snippets to a sender

All functions follow the project's AI-call convention:
    ant = getattr(advisor.ai, "_anthropic", None)
    model = haiku in budget mode else sonnet-4-6
    fall back to advisor.ai.messages.create when no raw anthropic client.
"""
import json as _json
import logging

_log = logging.getLogger(__name__)

_HAIKU = "claude-haiku-4-5-20251001"
_SONNET = "claude-sonnet-4-6"

NEGOTIATION_TYPES = {"price", "deadline", "commitment", "concession", "risk"}
NEGOTIATION_IMPORTANCE = {"low", "medium", "high"}


async def _ai_text(advisor, prompt: str, max_tokens: int, *, budget_ok_haiku: bool = True) -> str:
    """Run a single-shot AI completion and return the stripped text."""
    ant = getattr(advisor.ai, "_anthropic", None)
    if budget_ok_haiku:
        model = _HAIKU
    else:
        model = _HAIKU if getattr(advisor.ai, "_budget_mode", False) else _SONNET
    client = ant or advisor.ai
    resp = await client.messages.create(
        model=model, max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip()


def _extract_json(text: str, opener: str = "{", closer: str = "}"):
    """Pull the first JSON object/array out of a (possibly fenced) AI response."""
    s, e = text.find(opener), text.rfind(closer) + 1
    if s < 0 or e <= s:
        return None
    return _json.loads(text[s:e])


async def score_draft(advisor, draft: str, context: str = "") -> dict:
    """Score a draft email reply 1-100 with actionable suggestions and strengths."""
    ctx = f"\n\nCONTEXT (email being replied to):\n{context[:1500]}" if context.strip() else ""
    prompt = (
        "You are an expert executive communication coach. Score the following email draft "
        "on a scale of 1-100 for professionalism, clarity, tone, and effectiveness."
        f"{ctx}\n\nDRAFT:\n{draft[:3000]}\n\n"
        'Return ONLY valid JSON:\n'
        '{"score": <int 1-100>, '
        '"suggestions": ["specific improvement 1", "specific improvement 2"], '
        '"strengths": ["what works well 1", "what works well 2"]}'
    )
    try:
        text = await _ai_text(advisor, prompt, 600)
        data = _extract_json(text) or {}
    except Exception as e:
        _log.error("score_draft failed: %s", e, exc_info=True)
        data = {}

    try:
        score = int(data.get("score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(1, min(100, score)) if score else 50
    suggestions = [str(s) for s in (data.get("suggestions") or [])][:6]
    strengths = [str(s) for s in (data.get("strengths") or [])][:6]
    return {"score": score, "suggestions": suggestions, "strengths": strengths}


async def negotiation_radar(advisor, text: str) -> list[dict]:
    """Extract negotiation signals from email text.

    Returns a list of {phrase, type, importance} where type is one of
    price/deadline/commitment/concession/risk and importance is low/medium/high.
    """
    prompt = (
        "Analyze this email for negotiation signals. Identify phrases that indicate a "
        "PRICE (money/cost/budget/discount), DEADLINE (dates/timing/urgency), "
        "COMMITMENT (promises/agreements/guarantees), CONCESSION (giving ground/flexibility/compromise), "
        "or RISK (threats/warnings/conditions/deal-breakers).\n\n"
        f"EMAIL:\n{text[:3000]}\n\n"
        'Return ONLY a JSON array (max 15 items):\n'
        '[{"phrase": "exact phrase from email", "type": "price|deadline|commitment|concession|risk", '
        '"importance": "low|medium|high"}]\n'
        "If no signals found, return []."
    )
    try:
        raw = await _ai_text(advisor, prompt, 800)
        items = _extract_json(raw, "[", "]") or []
    except Exception as e:
        _log.error("negotiation_radar failed: %s", e, exc_info=True)
        items = []

    signals: list[dict] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        phrase = str(it.get("phrase", "")).strip()
        typ = str(it.get("type", "")).strip().lower()
        imp = str(it.get("importance", "medium")).strip().lower()
        if not phrase or typ not in NEGOTIATION_TYPES:
            continue
        if imp not in NEGOTIATION_IMPORTANCE:
            imp = "medium"
        signals.append({"phrase": phrase[:300], "type": typ, "importance": imp})
    return signals[:15]


async def suggested_opener(advisor, sender: str, snippets: list[str]) -> str:
    """Generate a personalized opener line based on prior correspondence to a sender."""
    if not snippets:
        return ""
    joined = "\n---\n".join(s[:400] for s in snippets[:3])
    prompt = (
        f"Based on my past emails to {sender}, suggest a warm, natural opening line for a new "
        "email to them that reflects our established rapport and communication style. "
        "Return ONLY the single opening line, no preamble, no quotes.\n\n"
        f"MY PAST EMAILS TO THEM:\n{joined}"
    )
    try:
        return await _ai_text(advisor, prompt, 150)
    except Exception as e:
        _log.error("suggested_opener failed: %s", e, exc_info=True)
        return ""
