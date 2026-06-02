import json
from models import EmailMessage, AIRecommendation, EmailSummary
from services.ai_client import AIClient

_SEARCH_TOOL = {
    "name": "search_context",
    "description": (
        "Search your email history and documents for additional context relevant to this email. "
        "Use this to find related contracts, prior conversations, referenced documents, or "
        "relevant past decisions before making your final recommendation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to find relevant emails or documents",
            }
        },
        "required": ["query"],
    },
}

_MAX_TOOL_CALLS = 3


class AIAdvisor:
    def __init__(self, client: AIClient, rag=None):
        self.ai = client
        self.rag = rag  # optional RAGEngine for agentic search loop

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

        # Use agentic loop when Anthropic client is available — Claude iteratively
        # retrieves additional context via search_context tool before recommending.
        ant = getattr(self.ai, "_anthropic", None)
        if ant and self.rag:
            data = await self._agentic_call(ant, prompt)
        else:
            resp = await self.ai.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1800,
                messages=[{"role": "user", "content": prompt}],
            )
            data = self._parse_json(resp.content[0].text)

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

    # ── Agentic helpers ───────────────────────────────────────────────────────

    def _parse_json(self, text: str) -> dict:
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("{"), text.rfind("}") + 1
            try:
                return json.loads(text[start:end]) if start >= 0 else {}
            except json.JSONDecodeError:
                return {}

    async def _agentic_call(self, ant, prompt: str) -> dict:
        """
        Agentic loop: Claude calls search_context tool to retrieve additional
        context (up to _MAX_TOOL_CALLS times) before producing the final JSON.
        """
        model = "claude-haiku-4-5-20251001" if self.ai._budget_mode else "claude-sonnet-4-6"
        messages = [{"role": "user", "content": prompt}]

        for _ in range(_MAX_TOOL_CALLS + 1):
            resp = await ant.messages.create(
                model=model,
                max_tokens=2000,
                tools=[_SEARCH_TOOL],
                messages=messages,
            )

            if resp.stop_reason != "tool_use":
                text = next((b.text for b in resp.content if hasattr(b, "text")), "")
                return self._parse_json(text)

            # Handle tool calls — execute each search and feed results back
            messages.append({"role": "assistant", "content": resp.content})
            tool_results = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                query = block.input.get("query", "")
                hits = self.rag.hybrid_search(query, n_results=5) if query else []
                result_text = "\n\n".join(
                    f"[{h.get('source_type','email')}] {h.get('subject','')}\n"
                    f"{h.get('text','')[:500]}"
                    for h in hits
                ) or "No results found."
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                })
            messages.append({"role": "user", "content": tool_results})

        # Max iterations reached — force a final text response without tools
        resp = await ant.messages.create(
            model=model, max_tokens=2000, messages=messages,
        )
        text = next((b.text for b in resp.content if hasattr(b, "text")), "")
        return self._parse_json(text)
