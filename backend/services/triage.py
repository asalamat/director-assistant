"""
Smart Daily Triage: scores unread emails by urgency to surface the top items
that need attention today.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

_URGENCY_SUBJECT = [
    "urgent", "asap", "action required", "action needed", "time sensitive",
    "deadline", "due today", "by today", "by eod", "by cob", "required by",
    "must respond", "please respond", "overdue", "critical", "immediately",
    "high priority", "final reminder", "last chance",
]

_URGENCY_BODY = [
    "urgent", "asap", "action required", "deadline", "due today",
    "by today", "by eod", "required by", "overdue", "critical", "immediately",
]


def _score(email: dict, vip_senders: set, has_action_ids: set) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    subject = (email.get("subject") or "").lower()
    body_preview = (email.get("body") or "")[:400].lower()
    sender = (email.get("sender") or "").lower()
    date_str = email.get("date") or ""
    email_id = email.get("id", "")

    # Urgency keywords in subject (highest signal)
    for kw in _URGENCY_SUBJECT:
        if kw in subject:
            score += 3
            reasons.append("urgent subject")
            break

    # Urgency keywords in body
    if "urgent subject" not in reasons:
        for kw in _URGENCY_BODY:
            if kw in body_preview:
                score += 2
                reasons.append("urgent content")
                break

    # Has an open action item linked to this email
    if email_id in has_action_ids:
        score += 3
        reasons.append("open action item")

    # VIP sender (appears frequently in your inbox)
    if any(s in sender for s in vip_senders):
        score += 2
        reasons.append("frequent contact")

    # Recency bonus
    if date_str:
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            age = datetime.now(timezone.utc) - dt.astimezone(timezone.utc)
            if age < timedelta(hours=24):
                score += 2
                reasons.append("received today")
            elif age < timedelta(hours=48):
                score += 1
                reasons.append("received yesterday")
        except Exception:
            pass

    # Question in subject → likely needs a response
    if "?" in (email.get("subject") or ""):
        score += 1
        reasons.append("question asked")

    return score, reasons[:3]


def _apply_user_rules(email: dict, rules: list[str]) -> tuple[int, list[str]]:
    """Evaluate simple natural-language rules against an email.

    Supported patterns (case-insensitive):
      from: <text> → critical/urgent/high/low
      subject contains: <text> → critical/urgent/high/low
      sender is: <text> → critical/urgent/high/low
      <keyword> in subject → boost/critical/urgent
    Returns a score delta and matched reason labels.
    """
    bonus = 0
    reasons = []
    subject = (email.get("subject") or "").lower()
    sender  = (email.get("sender")  or "").lower()
    body    = (email.get("body")    or "")[:400].lower()

    _LEVEL = {"critical": 5, "urgent": 4, "high": 3, "medium": 2, "low": -3, "skip": -10}

    for rule in rules:
        r = rule.strip().lower()
        level_bonus = 3  # default bonus if rule matches without explicit level
        level_label = "rule match"
        for word, pts in _LEVEL.items():
            if f"→ {word}" in r or f"-> {word}" in r:
                level_bonus = pts
                level_label = f"rule: {word}"
                break

        matched = False
        if r.startswith("from:") or r.startswith("sender is:") or r.startswith("sender:"):
            fragment = r.split(":", 1)[1].split("→")[0].split("->")[0].strip()
            if fragment and fragment in sender:
                matched = True
        elif "subject contains:" in r or "subject has:" in r:
            fragment = r.split(":", 1)[1].split("→")[0].split("->")[0].strip()
            if fragment and fragment in subject:
                matched = True
        elif "in subject" in r or "subject contains" in r:
            fragment = r.split("in subject")[0].split("subject contains")[0].strip().strip('"\'')
            if fragment and fragment in subject:
                matched = True
        elif "in body" in r:
            fragment = r.split("in body")[0].strip().strip('"\'')
            if fragment and fragment in body:
                matched = True

        if matched:
            bonus += level_bonus
            reasons.append(level_label)

    return bonus, reasons


def get_top_emails(cache, limit: int = 7) -> list[dict]:
    """Return top N unread emails scored by urgency (last 14 days)."""
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, date, body, is_read
               FROM emails
               WHERE is_read = 0 AND date >= datetime('now', '-14 days')
               ORDER BY date DESC LIMIT 300"""
        ).fetchall()
        emails = [dict(r) for r in rows]

        # VIP senders: top 30 by frequency
        vip_rows = conn.execute(
            "SELECT LOWER(sender) FROM emails GROUP BY LOWER(sender) ORDER BY COUNT(*) DESC LIMIT 30"
        ).fetchall()
        vip_senders = {r[0].split("@")[0] for r in vip_rows if r[0]}

        # Emails with open action items
        action_rows = conn.execute(
            "SELECT DISTINCT email_id FROM action_items WHERE done = 0"
        ).fetchall()
        has_action_ids = {r[0] for r in action_rows}

        # User-defined triage rules
        rule_rows = conn.execute("SELECT rule FROM triage_rules ORDER BY id").fetchall()
        user_rules = [r[0] for r in rule_rows]

    scored = []
    for em in emails:
        sc, reasons = _score(em, vip_senders, has_action_ids)
        if user_rules:
            rule_bonus, rule_reasons = _apply_user_rules(em, user_rules)
            sc += rule_bonus
            reasons = (reasons + rule_reasons)[:3]
        if sc > 0:
            scored.append({
                "id": em["id"],
                "subject": em["subject"] or "(no subject)",
                "sender": em["sender"] or "",
                "date": (em["date"] or "")[:10],
                "preview": ((em["body"] or "")[:120]).replace("\n", " "),
                "score": sc,
                "reasons": reasons,
            })

    scored.sort(key=lambda x: -x["score"])
    return scored[:limit]
