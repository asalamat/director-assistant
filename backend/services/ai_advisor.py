import json
import anthropic
from models import EmailMessage, AIRecommendation, EmailSummary


class AIAdvisor:
    def __init__(self, client: anthropic.AsyncAnthropic):
        self.client = client

    async def get_recommendation(
        self, email: EmailMessage, similar: list[dict]
    ) -> AIRecommendation:
        context = "\n\n".join(
            f"--- Context Email {i+1} ---\n"
            f"Subject: {e['subject']}\nFrom: {e['sender']}\nDate: {e['date']}\n"
            f"Preview: {e['text'][:400]}"
            for i, e in enumerate(similar)
        ) or "No similar past emails found."

        body_preview = (email.body or "")[:4000]

        prompt = f"""You are an executive email advisor. Analyze this email and provide recommendations.

EMAIL:
From: {email.sender}
To: {', '.join(email.recipients) if email.recipients else 'me'}
Date: {email.date}
Subject: {email.subject}

{body_preview}

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

        resp = await self.client.messages.create(
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
