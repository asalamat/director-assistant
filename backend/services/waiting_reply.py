"""Detect sent emails that haven't received a reply."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone


def get_waiting_replies(cache, threshold_days: int = 3, limit: int = 20) -> list[dict]:
    """Return sent emails older than threshold_days with no detected reply."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=threshold_days)).strftime("%Y-%m-%dT%H:%M:%S")

    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, recipients, date, thread_id
               FROM emails
               WHERE LOWER(folder) LIKE '%sent%'
               AND date <= ?
               AND date >= datetime('now', '-30 days')
               ORDER BY date DESC LIMIT 200""",
            (cutoff,),
        ).fetchall()

        waiting = []
        for row in rows:
            em = dict(row)
            has_reply = False

            # Check by thread_id first (most reliable)
            if em.get("thread_id"):
                reply = conn.execute(
                    """SELECT 1 FROM emails
                       WHERE thread_id = ? AND date > ?
                       AND LOWER(folder) NOT LIKE '%sent%' LIMIT 1""",
                    (em["thread_id"], em["date"]),
                ).fetchone()
                has_reply = reply is not None

            # Fallback: check for "Re: <subject>" in inbox
            if not has_reply and em.get("subject"):
                base = em["subject"].removeprefix("Re: ").removeprefix("RE: ").removeprefix("Fwd: ")[:70]
                # Escape LIKE special chars so subject literals match exactly
                escaped = base.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                reply = conn.execute(
                    """SELECT 1 FROM emails
                       WHERE subject LIKE ? ESCAPE '\\' AND date > ?
                       AND LOWER(folder) NOT LIKE '%sent%' LIMIT 1""",
                    (f"Re: {escaped}%", em["date"]),
                ).fetchone()
                has_reply = reply is not None

            if has_reply:
                continue

            try:
                dt = datetime.fromisoformat(em["date"].replace("Z", "+00:00"))
                days_waiting = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).days
            except Exception:
                days_waiting = 0

            try:
                rcpts = json.loads(em.get("recipients") or "[]")
                recipient = rcpts[0] if rcpts else ""
            except Exception:
                recipient = ""

            waiting.append({
                "id": em["id"],
                "subject": em["subject"] or "(no subject)",
                "sender": em["sender"] or "",
                "recipient": recipient,
                "date": (em["date"] or "")[:10],
                "days_waiting": days_waiting,
            })

    waiting.sort(key=lambda x: -x["days_waiting"])
    return waiting[:limit]
