import asyncio
import json
import re
from typing import List

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/api/ask", tags=["ask"])

_QUESTION_PREAMBLES = re.compile(
    r"^(?:who\s+is|who\s+are|what\s+is|what\s+are|where\s+is|when\s+is|"
    r"what\s+do\s+(?:you\s+)?know\s+(?:about\s+)?|"
    r"what\s+can\s+you\s+tell\s+me\s+(?:about\s+)?|"
    r"can\s+you\s+(?:please\s+)?(?:tell\s+me\s+|show\s+me\s+)?(?:about\s+)?|"
    r"do\s+you\s+(?:have\s+(?:any\s+)?(?:emails?\s+)?(?:(?:about|from|on)\s+)?|know\s+(?:about\s+)?)|"
    r"how\s+(?:many\s+|much\s+)?(?:emails?\s+|messages?\s+)?(?:(?:from|about|by|to)\s+)?|"
    r"how\s+is|tell\s+me\s+(?:about\s+|more\s+about\s+)?|"
    r"show\s+me\s+(?:emails?\s+(?:from|about)\s+)?|"
    r"find\s+(?:emails?\s+(?:from|about)\s+)?|"
    r"(?:list|count|get)\s+(?:all\s+)?(?:emails?\s+)?(?:(?:from|about|by)\s+)?|"
    r"emails?\s+(?:from|about|by)\s+|"
    r"i\s+(?:want|need|would\s+like)\s+to\s+(?:know|find|see)\s+(?:about\s+|more\s+about\s+)?|"
    r"(?:search|look)\s+(?:for\s+)?(?:emails?\s+(?:about|from)\s+)?)\s*",
    re.IGNORECASE,
)

# Fallback: extract topic after "about", "regarding", "on", "concerning"
_ABOUT_EXTRACTOR = re.compile(
    r"\b(?:about|regarding|concerning|on\s+the\s+topic\s+of|related\s+to)\s+(.+?)(?:\s*[?.]?\s*$)",
    re.IGNORECASE,
)

_COUNT_QUESTION = re.compile(
    r"\b(?:how\s+many|count|total\s+(?:number\s+of)?)\b.*\b(?:email|message)s?\b",
    re.IGNORECASE,
)

_SENDER_EXTRACT = re.compile(
    r"\b(?:from|by|sent\s+by)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s*[?,.]|\s*$)",
    re.IGNORECASE,
)

_META_WORDS = frozenset({
    "how", "many", "much", "count", "number", "total", "list",
    "email", "emails", "message", "messages", "mail",
    "from", "about", "by", "in", "for",
})


def _search_query(question: str) -> str:
    stripped = _QUESTION_PREAMBLES.sub("", question).strip()
    words = stripped.split()
    filtered = [w for w in words if w.lower() not in _META_WORDS]
    result = " ".join(filtered).strip() or stripped or question
    # If preamble stripping left too many generic words, try extracting what comes after "about"
    if len(result.split()) > 4:
        m = _ABOUT_EXTRACTOR.search(question)
        if m:
            candidate = m.group(1).strip()
            cwords = [w for w in candidate.split() if w.lower() not in _META_WORDS]
            if cwords:
                result = " ".join(cwords)
    return result


def _extract_sender_name(question: str) -> str | None:
    m = _SENDER_EXTRACT.search(question)
    if m:
        return m.group(1).strip()
    q = _search_query(question)
    if q and len(q.split()) <= 3 and q[0].isupper():
        return q
    return None


class HistoryMessage(BaseModel):
    role: str
    content: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("user", "assistant"):
            raise ValueError(f"role must be 'user' or 'assistant', got {v!r}")
        return v


class AskRequest(BaseModel):
    question: str
    n_results: int = 15
    history: List[HistoryMessage] = []


@router.post("")
async def ask_db(req: AskRequest, request: Request):
    rag = request.app.state.rag
    cache = request.app.state.cache
    ai = request.app.state.advisor.ai

    question = req.question.strip()

    async def generate():
        if not question:
            yield 'data: {"type":"token","text":"Please enter a question."}\n\n'
            yield 'data: {"type":"done"}\n\n'
            return

        # Count hint — instant DB query, done before streaming starts
        count_hint = ""
        if _COUNT_QUESTION.search(question):
            sender_name = _extract_sender_name(question)
            if sender_name:
                exact_count = cache.count_by_sender(sender_name)
                count_hint = (
                    f"\n\nDB FACT: There are exactly {exact_count} emails from "
                    f"'{sender_name}' in the database. Use this exact number."
                )

        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None, rag.hybrid_search, _search_query(question), req.n_results
        )
        if not results:
            yield 'data: {"type":"token","text":"No emails or documents found in the database. Try importing emails or indexing a document folder first."}\n\n'
            yield 'data: {"type":"done"}\n\n'
            return

        def _format_result(i: int, r: dict) -> str:
            if r.get("source_type") == "document":
                return (
                    f"[{i+1}] DOCUMENT: {r.get('filename', 'unknown')}\n"
                    f"    Type: {r.get('file_type', '').upper()}\n"
                    f"    Content: {r['text'][:1500]}"
                )
            return (
                f"[{i+1}] EMAIL — Subject: {r['subject']}\n"
                f"    From: {r['sender']}\n"
                f"    Date: {r['date']}\n"
                f"    Preview: {r['text'][:400]}"
            )

        # Show up to 5 documents + 8 emails in context (documents always included)
        doc_results = [r for r in results if r.get("source_type") == "document"][:5]
        email_results = [r for r in results if r.get("source_type") != "document"][:8]
        ordered = doc_results + email_results if doc_results else email_results
        context = "\n\n".join(_format_result(i, r) for i, r in enumerate(ordered))

        has_docs = any(r.get("source_type") == "document" for r in results[:10])
        has_emails = any(r.get("source_type") != "document" for r in results[:10])
        source_desc = (
            "emails and documents" if has_docs and has_emails
            else "documents" if has_docs
            else "emails"
        )

        # Build messages: conversation history + current question with context
        messages = []
        for h in req.history[-6:]:  # last 3 turns (6 messages)
            messages.append({"role": h.role, "content": h.content})

        messages.append({
            "role": "user",
            "content": (
                f"CONTEXT ({source_desc.upper()}):\n{context}"
                f"{count_hint}\n\n"
                f"QUESTION: {question}"
            ),
        })

        try:
            async with ai.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                system=(
                    f"You are an executive assistant with access to a database of {source_desc}. "
                    f"Answer based ONLY on the {source_desc} shown below. Be concise and specific."
                ),
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'token', 'text': f'Error generating answer: {e}'})}\n\n"

        sources = []
        for r in results[:5]:
            src: dict = {
                "email_id": r["email_id"],
                "source_type": r.get("source_type", "email"),
                "subject": r.get("subject", ""),
                "sender": r.get("sender", ""),
                "date": r.get("date", ""),
            }
            if r.get("source_type") == "document":
                src["filename"] = r.get("filename", "")
                src["file_type"] = r.get("file_type", "")
            sources.append(src)
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
        yield 'data: {"type":"done"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
