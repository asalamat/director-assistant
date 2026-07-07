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

    # ── Writing-style extraction (Voice-Matched Drafts) ───────────────────────

    async def extract_writing_style(self, sent_emails: list[str]) -> dict:
        """Analyze a sample of sent emails and return a JSON writing-style profile.

        Captures the dimensions needed to reproduce the user's voice in drafts:
        formality, greeting/closing habits, sentence length, vocabulary, and
        punctuation/emoji tendencies. Bodies are truncated to 500 chars each by
        the caller before being passed in.
        """
        samples = "\n\n--- SENT EMAIL ---\n".join(
            (s or "")[:500] for s in sent_emails if (s or "").strip()
        )
        if not samples.strip():
            return {}

        prompt = f"""Analyze the writing style of these emails the user has sent. \
Produce a profile another writer could follow to imitate this person's voice.

SENT EMAILS:
{samples}

Return ONLY valid JSON with exactly these fields:
{{
  "formality": "one of: very formal / formal / neutral / casual / very casual",
  "avg_sentence_length": "one of: short / medium / long",
  "greeting_style": "how they typically open, e.g. 'Hi <name>,' or 'Hello,' or none",
  "closing_style": "how they typically sign off, e.g. 'Best,' / 'Thanks,' / 'Cheers,'",
  "signature_name": "the name they sign with, or null",
  "punctuation": "notable habits, e.g. 'uses exclamation marks', 'minimal punctuation'",
  "emoji_usage": "one of: none / rare / frequent",
  "vocabulary": "one of: simple / moderate / sophisticated / technical",
  "tone": "overall tone in 2-4 words, e.g. 'warm and direct'",
  "summary": "1-2 sentence description of how this person writes"
}}
Return ONLY JSON, no markdown."""

        ant = getattr(self.ai, "_anthropic", None)
        _m = "claude-haiku-4-5-20251001" if self.ai._budget_mode else "claude-sonnet-4-6"
        try:
            if ant:
                resp = await ant.messages.create(
                    model=_m, max_tokens=600,
                    messages=[{"role": "user", "content": prompt}],
                )
            else:
                resp = await self.ai.messages.create(
                    model=_m, max_tokens=600,
                    messages=[{"role": "user", "content": prompt}],
                )
            return self._parse_json(resp.content[0].text)
        except Exception:
            return {}

    # ── Tone Coach ────────────────────────────────────────────────────────────

    async def analyze_tone(self, text: str) -> dict:
        """Classify the tone of a draft and detect common issues.

        Returns: {tone, score (0-1), issues: list[str], label, suggestions: list[str]}
        """
        prompt = f"""Analyze the tone of this email draft and flag any issues.

DRAFT:
{text[:4000]}

Detect problems such as: passive-aggressive phrasing, overly apologetic language,
no clear ask or call to action, abrupt/rude tone, rambling/unclear wording.

Return ONLY this JSON (arrays may be empty):
{{
  "tone": "one-or-two word tone, e.g. professional / warm / abrupt / apologetic",
  "score": 0.0,
  "issues": ["short issue label, e.g. Sounds passive-aggressive", "No clear ask"],
  "label": "good" | "warning" | "issue",
  "suggestions": ["brief actionable suggestion", ...]
}}

score is 0-1 where 1.0 is excellent professional tone with no issues.
label rules: "good" = score >= 0.75 and no issues; "warning" = minor concerns;
"issue" = serious tone problems (rude, passive-aggressive, very unclear)."""

        ant = getattr(self.ai, "_anthropic", None)
        _m = "claude-haiku-4-5-20251001" if self.ai._budget_mode else "claude-sonnet-4-6"
        try:
            if ant:
                resp = await ant.messages.create(
                    model=_m, max_tokens=500,
                    messages=[{"role": "user", "content": prompt}],
                )
            else:
                resp = await self.ai.messages.create(
                    model=_m, max_tokens=500,
                    messages=[{"role": "user", "content": prompt}],
                )
            data = self._parse_json(resp.content[0].text)
        except Exception:
            data = {}

        try:
            score = float(data.get("score", 0.5))
        except (TypeError, ValueError):
            score = 0.5
        score = max(0.0, min(1.0, score))
        label = data.get("label", "warning")
        if label not in ("good", "warning", "issue"):
            label = "warning"
        return {
            "tone": data.get("tone", "neutral"),
            "score": score,
            "issues": data.get("issues", []),
            "label": label,
            "suggestions": data.get("suggestions", []),
        }

    async def batch_rewrite(self, text: str, tones: list[str]) -> list[dict]:
        """Rewrite the given text in each requested tone.

        Returns a list of {tone, text} dicts, one per requested tone.
        """
        TONE_INSTRUCTIONS = {
            "warmer": "warmer and friendlier, while keeping it professional",
            "more_direct": "more direct and assertive, cutting hedging and filler",
            "more_formal": "more formal and professional",
            "shorter": "significantly shorter while keeping all key information",
            "more_enthusiastic": "more enthusiastic and energetic, without sounding fake",
            "more_concise": "more concise and to-the-point, removing redundancy",
        }
        ant = getattr(self.ai, "_anthropic", None)
        _m = "claude-haiku-4-5-20251001" if self.ai._budget_mode else "claude-sonnet-4-6"
        results: list[dict] = []
        for tone in tones:
            instruction = TONE_INSTRUCTIONS.get(tone)
            if not instruction:
                continue
            prompt = (
                f"Rewrite the following email text to be {instruction}. "
                "Keep the author's meaning, stance, and intent intact. "
                "Return ONLY the rewritten text — no preamble, no quotes.\n\n"
                f"{text[:4000]}"
            )
            try:
                if ant:
                    resp = await ant.messages.create(
                        model=_m, max_tokens=900,
                        messages=[{"role": "user", "content": prompt}],
                    )
                else:
                    resp = await self.ai.messages.create(
                        model=_m, max_tokens=900,
                        messages=[{"role": "user", "content": prompt}],
                    )
                rewritten = resp.content[0].text.strip()
            except Exception:
                rewritten = ""
            results.append({"tone": tone, "text": rewritten})
        return results

    # ── Commitment extraction ─────────────────────────────────────────────────

    async def extract_commitments(
        self, thread_body: str, participants: list[str]
    ) -> list[dict]:
        """Extract commitments (promises) from an email thread.

        Returns a list of dicts with keys: direction ('i_owe'|'they_owe'),
        description, counterparty, due_date (ISO date or null). Falls back to []
        on any parse/transport error.
        """
        body = (thread_body or "")[:3000]
        if not body.strip():
            return []
        people = ", ".join(p for p in participants if p) or "unknown"

        prompt = (
            "You are analyzing an email thread to extract concrete commitments "
            "(promises to deliver something, send a document, follow up, decide, "
            "or take an action by a point in time).\n\n"
            f"Thread participants: {people}\n"
            f"Thread content:\n{body}\n\n"
            "For each commitment, decide the direction from the account owner's "
            "perspective:\n"
            '- "i_owe" = the account owner promised something to someone else\n'
            '- "they_owe" = someone else promised something to the account owner\n\n'
            "Return ONLY a JSON object of this exact shape:\n"
            '{"commitments": [{"direction": "i_owe", "description": "...", '
            '"counterparty": "name or email", "due_date": "YYYY-MM-DD or null"}]}\n'
            "If there are no clear commitments, return {\"commitments\": []}. "
            "No markdown, no explanation."
        )

        try:
            ant = getattr(self.ai, "_anthropic", None)
            _m = "claude-haiku-4-5-20251001" if self.ai._budget_mode else "claude-sonnet-4-6"
            if ant:
                resp = await ant.messages.create(
                    model=_m,
                    max_tokens=700,
                    messages=[{"role": "user", "content": prompt}],
                )
                text = next((b.text for b in resp.content if hasattr(b, "text")), "")
            else:
                resp = await self.ai.messages.create(
                    model=_m,
                    max_tokens=700,
                    messages=[{"role": "user", "content": prompt}],
                )
                text = resp.content[0].text
        except Exception:
            return []

        data = self._parse_json(text)
        raw = data.get("commitments", [])
        if not isinstance(raw, list):
            return []

        out: list[dict] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            direction = item.get("direction")
            description = (item.get("description") or "").strip()
            if direction not in ("i_owe", "they_owe") or not description:
                continue
            due = item.get("due_date")
            if due in ("null", "", "none", "None"):
                due = None
            out.append({
                "direction": direction,
                "description": description[:500],
                "counterparty": (item.get("counterparty") or "").strip()[:200],
                "due_date": due,
            })
        return out

    # ── Agentic helpers ───────────────────────────────────────────────────────

    async def extract_linkedin_voice(self, posts: list[str]) -> dict:
        """Analyze the user's past LinkedIn posts and extract their writing voice.

        Returns: {avg_length, hook_style, emoji_usage, cta_style, formality, recurring_themes}
        """
        if not posts:
            return {}
        sample = "\n\n---\n\n".join(f"POST {i+1}:\n{p[:300]}" for i, p in enumerate(posts))
        prompt = f"""You are a writing-style analyst. Study the following LinkedIn posts written by one person
and extract their distinctive voice so it can be reused to write new posts in the same style.

{sample}

Return ONLY this JSON:
{{
  "avg_length": "short" | "medium" | "long",
  "hook_style": "how they open posts, e.g. provocative question / bold statement / personal story / statistic",
  "emoji_usage": "none" | "minimal" | "moderate" | "heavy",
  "cta_style": "how they close / call to action, e.g. asks a question / invites DMs / no CTA / shares a takeaway",
  "formality": "casual" | "conversational" | "professional" | "formal",
  "recurring_themes": ["short theme label", "..."]
}}"""

        ant = getattr(self.ai, "_anthropic", None)
        try:
            if ant:
                resp = await ant.messages.create(
                    model="claude-sonnet-4-6", max_tokens=600,
                    messages=[{"role": "user", "content": prompt}],
                )
            else:
                resp = await self.ai.messages.create(
                    model="claude-sonnet-4-6", max_tokens=600,
                    messages=[{"role": "user", "content": prompt}],
                )
            data = self._parse_json(resp.content[0].text)
        except Exception:
            data = {}

        themes = data.get("recurring_themes", [])
        if not isinstance(themes, list):
            themes = []
        return {
            "avg_length": data.get("avg_length", "medium"),
            "hook_style": data.get("hook_style", ""),
            "emoji_usage": data.get("emoji_usage", "minimal"),
            "cta_style": data.get("cta_style", ""),
            "formality": data.get("formality", "professional"),
            "recurring_themes": [str(t).strip() for t in themes if str(t).strip()][:8],
        }

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
        model = "claude-haiku-4-5-20251001" if self.ai._budget_mode else "claude-sonnet-4-6"  # agentic RAG loop
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
