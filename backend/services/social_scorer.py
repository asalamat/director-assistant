"""Predictive post performance scoring — pure heuristics, no AI.

Scores LinkedIn/Instagram posts 0-1 based on length, hashtag count, CTA presence,
time-of-day, and hook quality, returning per-factor scores and actionable suggestions.
"""

from datetime import datetime

_CTA_PHRASES = (
    "comment", "share", "let me know", "what do you think", "drop a",
    "tell me", "join", "sign up", "learn more", "read more", "follow",
    "dm me", "reach out", "get in touch", "click", "check out", "tag",
    "save this", "thoughts?",
)

_HOOK_SIGNALS = (":", "?", "…", "...", "—", "!")


def _length_score(text: str, platform: str) -> float:
    n = len(text)
    if platform == "instagram":
        if 100 <= n <= 200:
            return 1.0
        if n < 20 or n > 2000:
            return 0.3
        if n < 100:
            return 0.7
        return 0.6
    # linkedin (default)
    if 150 <= n <= 300:
        return 1.0
    if n < 50 or n > 2000:
        return 0.3
    if n < 150:
        return 0.7
    return 0.6


def _hashtag_score(hashtags: list[str]) -> float:
    n = len(hashtags)
    if 3 <= n <= 5:
        return 1.0
    if n == 0:
        return 0.4
    if n > 15:
        return 0.5
    if n in (1, 2):
        return 0.7
    return 0.8  # 6-15


def _has_cta(text: str) -> bool:
    stripped = text.rstrip()
    if stripped.endswith("?"):
        return True
    lower = text.lower()
    return any(phrase in lower for phrase in _CTA_PHRASES)


def _good_hook(text: str) -> bool:
    first_line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
    if not first_line or len(first_line) >= 100:
        return False
    return any(first_line.rstrip().endswith(sig) for sig in _HOOK_SIGNALS)


def _good_timing(scheduled_at: str | None) -> bool:
    if not scheduled_at:
        return False
    try:
        dt = datetime.fromisoformat(str(scheduled_at).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    if dt.weekday() >= 5:  # Sat/Sun
        return False
    h = dt.hour
    return (8 <= h < 10) or (h == 12) or (17 <= h < 18)


def score_post(text: str, hashtags: list[str], platform: str, scheduled_at: str | None = None) -> dict:
    text = text or ""
    hashtags = hashtags or []
    platform = (platform or "linkedin").lower()

    length = _length_score(text, platform)
    hashtag = _hashtag_score(hashtags)
    cta = _has_cta(text)
    hook = _good_hook(text)
    timing = _good_timing(scheduled_at)

    # Base score from length + hashtags (the two weighted factors), plus bonuses.
    base = length * 0.5 + hashtag * 0.5
    bonus = (0.1 if cta else 0.0) + (0.1 if timing else 0.0) + (0.1 if hook else 0.0)
    score = min(1.0, round(base * 0.7 + bonus, 3))

    suggestions: list[str] = []
    if length < 1.0:
        if platform == "instagram":
            suggestions.append("Aim for 100-200 characters — Instagram captions perform best when concise.")
        else:
            suggestions.append("Aim for 150-300 characters — LinkedIn rewards focused, punchy posts.")
    if hashtag < 1.0:
        if len(hashtags) == 0:
            suggestions.append("Add 3-5 relevant hashtags to expand reach.")
        elif len(hashtags) > 15:
            suggestions.append("Too many hashtags can look spammy — trim to 3-5 of the most relevant.")
        else:
            suggestions.append("Use 3-5 hashtags for the best balance of reach and focus.")
    if not cta:
        suggestions.append("Add a question or call-to-action to boost engagement.")
    if not hook:
        suggestions.append("Open with a short, punchy hook line under 100 characters.")
    if not timing and scheduled_at:
        suggestions.append("Schedule for a weekday peak window (8-10am, noon, or 5-6pm) for more visibility.")

    return {
        "score": score,
        "factors": {
            "length": round(length, 3),
            "hashtags": round(hashtag, 3),
            "cta": cta,
            "timing": timing,
            "hook": hook,
        },
        "suggestions": suggestions,
    }
