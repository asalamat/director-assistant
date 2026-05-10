"""Smart Priority Inbox — classifies emails with Claude Haiku."""

import logging
from typing import TYPE_CHECKING

import anthropic

if TYPE_CHECKING:
    from services.email_cache import EmailCache

logger = logging.getLogger(__name__)

CATEGORIES = ("action_required", "meeting", "fyi", "newsletter", "other")


class ClassifierService:
    def __init__(self, client: anthropic.AsyncAnthropic):
        self.ai = client

    async def classify(self, email_id: str, subject: str, sender: str, preview: str) -> str:
        prompt = (
            f"Classify this email into EXACTLY one category.\n"
            f"Subject: {subject}\nFrom: {sender}\nPreview: {preview[:200]}\n\n"
            f"Categories:\n"
            f"  action_required — needs a response or decision\n"
            f"  meeting — invite, calendar, scheduling\n"
            f"  fyi — informational only, no action needed\n"
            f"  newsletter — bulk/marketing/automated\n"
            f"  other — everything else\n\n"
            f"Reply with ONLY the category name."
        )
        try:
            resp = await self.ai.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=20,
                messages=[{"role": "user", "content": prompt}],
            )
            cat = resp.content[0].text.strip().lower()
            return cat if cat in CATEGORIES else "other"
        except Exception as e:
            logger.warning(f"[classifier] failed for {email_id}: {e}")
            return "other"

    async def classify_batch(
        self, cache: "EmailCache", email_ids: list[str]
    ) -> dict[str, str]:
        """Classify emails that don't yet have a category."""
        results: dict[str, str] = {}
        for eid in email_ids:
            if cache.get_category(eid):
                continue
            email = cache.get(eid)
            if not email:
                continue
            cat = await self.classify(
                eid,
                email.subject or "",
                email.sender or "",
                (email.body or "")[:200],
            )
            cache.set_category(eid, cat)
            results[eid] = cat
        return results
