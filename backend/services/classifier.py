"""Smart Priority Inbox — classifies emails with Claude Haiku."""

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from services.email_cache import EmailCache
    from services.ai_client import AIClient

logger = logging.getLogger(__name__)

CATEGORIES = (
    "proposal",       # business proposal, quote, RFP
    "contract",       # agreement, terms, legal document, NDA
    "invoice",        # invoice, payment, billing, receipt
    "meeting",        # invite, calendar, scheduling, agenda
    "action_required",# needs a response or decision
    "fyi",            # informational only, no action needed
    "newsletter",     # bulk/marketing/automated
    "other",
)

CATEGORY_LABELS = {
    "proposal":       ("Proposal",  "bg-blue-100 text-blue-700"),
    "contract":       ("Contract",  "bg-indigo-100 text-indigo-700"),
    "invoice":        ("Invoice",   "bg-yellow-100 text-yellow-700"),
    "meeting":        ("Meeting",   "bg-teal-100 text-teal-700"),
    "action_required":("Action",    "bg-orange-100 text-orange-700"),
    "fyi":            ("FYI",       "bg-gray-100 text-gray-600"),
    "newsletter":     ("Newsletter","bg-slate-100 text-slate-500"),
    "other":          ("Other",     "bg-gray-50 text-gray-400"),
}


class ClassifierService:
    def __init__(self, client: "AIClient"):
        self.ai = client

    async def classify(self, email_id: str, subject: str, sender: str, preview: str) -> str:
        prompt = (
            f"Classify this email into EXACTLY one category.\n"
            f"Subject: {subject}\nFrom: {sender}\nPreview: {preview[:200]}\n\n"
            f"Categories:\n"
            f"  proposal       — business proposal, quote, bid, RFP response\n"
            f"  contract       — agreement, contract, terms, NDA, legal document\n"
            f"  invoice        — invoice, payment request, billing, receipt, purchase order\n"
            f"  meeting        — calendar invite, scheduling, agenda, meeting notes\n"
            f"  action_required — needs a response, decision, or follow-up action\n"
            f"  fyi            — informational only, no action needed\n"
            f"  newsletter     — bulk email, marketing, automated notification\n"
            f"  other          — everything else\n\n"
            f"Reply with ONLY the category name, nothing else."
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
