"""Daily digest service — Claude-generated morning brief."""

import json
import logging
from datetime import date
from typing import TYPE_CHECKING

import anthropic

if TYPE_CHECKING:
    from services.email_cache import EmailCache

logger = logging.getLogger(__name__)


class DigestService:
    def __init__(self, client: anthropic.AsyncAnthropic):
        self.ai = client

    async def generate(self, cache: "EmailCache", hours: int = 24) -> dict:
        emails = cache.recent_emails_for_digest(hours=hours)
        count = len(emails)

        if count == 0:
            return {
                "date": str(date.today()),
                "summary": "No emails in the last 24 hours.",
                "top_action_items": [],
                "highlights": [],
                "email_count": 0,
            }

        listing = "\n".join(
            f"- From: {e.sender} | Subject: {e.subject} | Preview: {e.preview[:120]}"
            for e in emails[:40]
        )

        prompt = (
            f"You are an executive assistant preparing a morning brief. "
            f"Here are {count} emails from the last {hours} hours:\n\n"
            f"{listing}\n\n"
            f"Return a JSON object with these keys:\n"
            f"  summary: 2-3 sentence overview\n"
            f"  highlights: list of 3-5 most important items\n"
            f"  top_action_items: list of up to 5 action items requiring attention\n"
            f"Return ONLY the JSON, no markdown."
        )

        try:
            resp = await self.ai.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            data = json.loads(raw)
        except Exception as e:
            logger.warning(f"[digest] Claude failed ({e}), using fallback")
            data = {
                "summary": f"You have {count} emails in the last {hours} hours.",
                "highlights": [e.subject for e in emails[:5]],
                "top_action_items": [],
            }

        return {
            "date": str(date.today()),
            "summary": data.get("summary", ""),
            "highlights": data.get("highlights", []),
            "top_action_items": data.get("top_action_items", []),
            "email_count": count,
        }
