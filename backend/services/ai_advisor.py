import json
from models import EmailMessage, AIRecommendation, EmailSummary
from services.ai_client import AIClient


class AIAdvisor:
    def __init__(self, client: AIClient):
        self.ai = client

    async def get_recommendation(
        self, email: EmailMessage, similar: list[dict],
        related_docs: list[dict] | None = None,
        thread_history: list[dict] | None = None,
    ) -> AIRecommendation:
        context = "\n\n".join(
            f"--- Context Email {i+1} ---\n"
            f"Subject: {e['subject']}\nFrom: {e['sender']}\nDate: {e['date']}\n"
            f"Preview: {e['text'][:400]}"
            for i, e in enumerate(similar)
        ) or "No similar past emails found."

        doc_context = "\n\n".join(
            f"--- Document {i+1}: {d.get('subject', 'Untitled')} ---\n{d.get('text', '')[:600]}"
            for i, d in enumerate(related_docs or [])
        ) or "No related documents found."

        thread_ctx = "\n\n".join(
            f"--- Prior Message {i+1} ---\nFrom: {t['sender']}  Date: {t['date']}\n{t['text'][:800]}"
            for i, t in enumerate(thread_history or [])
        ) or "No prior messages in thread."

        body_preview = (email.body or "")[:4000]

        prompt = f"""You are an executive email advisor. Analyze this email and provide recommendations.

EMAIL:
From: {email.sender}
To: {', '.join(email.recipients) if email.recipients else 'me'}
Date: {email.date}
Subject: {email.subject}

{body_preview}

THREAD HISTORY (earlier messages in this conversation, oldest first):
{thread_ctx}

RELATED DOCUMENTS (contracts, reports, or files referenced by this email):
{doc_context}

SIMILAR PAST EMAILS FOR CONTEXT:
{context}

Return a JSON object with exactly these fields:
{{
  "suggested_replies": [
    "Brief (1-2 sentences, direct)",
    "Professional (3-5 sentences, formal)",
    "Detailed (comprehensive, addresses all points)"
  ],
  "key_points": ["list of the main points in the email that need addressing"],
  "tone": "one of: formal / casual / urgent / friendly / neutral",
  "action_items": ["concrete actions the recipient should take"],
  "urgency": "one of: low / medium / high / critical",
  "analysis": "2-3 sentences describing what this email is about and what kind of response is appropriate"
}}

Return ONLY valid JSON. No markdown, no explanation."""

        resp = await self.ai.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1800,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            data = json.loads(resp.content[0].text.strip())
        except json.JSONDecodeError:
            # Extract JSON if Claude wrapped it
            text = resp.content[0].text
            start = text.find("{")
            end = text.rfind("}") + 1
            data = json.loads(text[start:end]) if start >= 0 else {}

        similar_summaries = [
            EmailSummary(
                id=e["email_id"],
                subject=e["subject"],
                sender=e["sender"],
                date=e["date"],
                preview=e["text"][:150],
                is_read=True,
            )
            for e in similar
        ]

        return AIRecommendation(
            suggested_replies=data.get("suggested_replies", []),
            key_points=data.get("key_points", []),
            tone=data.get("tone", "neutral"),
            action_items=data.get("action_items", []),
            similar_emails=similar_summaries,
            urgency=data.get("urgency", "medium"),
            analysis=data.get("analysis", ""),
        )
