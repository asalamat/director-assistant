import asyncio
import json
import re
from typing import List, Optional

from fastapi import APIRouter, Query, Request
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

# Detects "who sent me the most emails" / "top senders" / "who emails me the most"
_TOP_SENDER_QUESTION = re.compile(
    r"\b(?:who\s+(?:sent|emails?|email[e]?d|writes?|wrote)\s+(?:me\s+)?(?:the\s+)?most"
    r"|top\s+senders?"
    r"|most\s+frequent\s+senders?"
    r"|who\s+(?:contacts?|emails?)\s+me\s+(?:the\s+)?most"
    r"|(?:most|highest)\s+emails?\s+from"
    r"|who\s+sends?\s+(?:me\s+)?(?:the\s+)?most)\b",
    re.IGNORECASE,
)

# Detects "how many emails this/last month/week/year/today"
_VOLUME_QUESTION = re.compile(
    r"\b(?:how\s+many\s+emails?\s+(?:did\s+i\s+(?:get|receive|send)|have\s+i\s+(?:got|received)|i\s+(?:received|got))?"
    r"|(?:total|count\s+of)\s+emails?\s+(?:received|sent|in)?)\b",
    re.IGNORECASE,
)

# Extract time period from question
_PERIOD_EXTRACT = re.compile(
    r"\b(this\s+(?:month|week|year)|last\s+(?:month|week|year)|today|this\s+quarter)\b",
    re.IGNORECASE,
)

_META_WORDS = frozenset({
    "how", "many", "much", "count", "number", "total", "list",
    "email", "emails", "message", "messages", "mail",
    "from", "about", "by", "in", "for",
})


def _extract_period(question: str) -> str:
    m = _PERIOD_EXTRACT.search(question)
    return m.group(1).lower() if m else "this month"


def _build_top_sender_fact(cache, question: str) -> str:
    """Run a direct DB aggregation for top-sender questions. Returns a DB FACTS string."""
    period = _extract_period(question)
    rows = cache.top_senders_period(period=period, limit=10)
    if not rows:
        return f"\n\nDB FACT: No emails found for the period '{period}'."
    lines = "\n".join(
        f"  {i+1}. {r['sender']} — {r['count']} email{'s' if r['count'] != 1 else ''}"
        for i, r in enumerate(rows)
    )
    return (
        f"\n\nDB FACTS (aggregated directly from database, 100% accurate):\n"
        f"Top email senders for {period}:\n{lines}\n"
        f"Use these exact numbers and names in your answer."
    )


def _build_volume_fact(cache, question: str) -> str:
    """Return total received/sent count for a period."""
    period = _extract_period(question)
    vol = cache.email_volume_period(period=period)
    return (
        f"\n\nDB FACT (aggregated directly from database, 100% accurate):\n"
        f"For {period}: {vol['total']} total emails "
        f"({vol['received']} received, {vol['sent']} sent).\n"
        f"Use these exact numbers."
    )


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


@router.get("/history")
async def get_ask_history(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """Return past Q&A history entries, newest first."""
    cache = request.app.state.cache
    loop = asyncio.get_event_loop()
    entries = await loop.run_in_executor(
        None, lambda: cache.list_ask_history(limit=limit, skip=skip)
    )
    return {"entries": entries, "total": len(entries)}


class AskHistoryEntry(BaseModel):
    question: str
    answer: str
    results_json: Optional[str] = "[]"


@router.post("/history")
async def add_ask_history(req: AskHistoryEntry, request: Request):
    """Manually save a Q&A entry to history."""
    cache = request.app.state.cache
    loop = asyncio.get_event_loop()
    entry_id = await loop.run_in_executor(
        None, lambda: cache.save_ask_history(req.question, req.answer, req.results_json or "[]")
    )
    return {"id": entry_id, "status": "saved"}


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

        # --- Aggregation shortcut: bypass RAG for statistical queries ---
        db_fact = ""
        is_aggregation = False

        if _TOP_SENDER_QUESTION.search(question):
            is_aggregation = True
            db_fact = await asyncio.get_event_loop().run_in_executor(
                None, _build_top_sender_fact, cache, question
            )
        elif _COUNT_QUESTION.search(question):
            sender_name = _extract_sender_name(question)
            if sender_name:
                exact_count = cache.count_by_sender(sender_name)
                db_fact = (
                    f"\n\nDB FACT: There are exactly {exact_count} emails from "
                    f"'{sender_name}' in the database. Use this exact number."
                )
            else:
                is_aggregation = True
                db_fact = await asyncio.get_event_loop().run_in_executor(
                    None, _build_volume_fact, cache, question
                )

        loop = asyncio.get_event_loop()
        results = []
        if not is_aggregation:
            results = await loop.run_in_executor(
                None, rag.hybrid_search, _search_query(question), req.n_results
            )
        if not results and not is_aggregation:
            yield 'data: {"type":"token","text":"No emails or documents found in the database. Try importing emails or indexing a document folder first."}\n\n'
            yield 'data: {"type":"done"}\n\n'
            return

        def _format_result(i: int, r: dict) -> str:
            if r.get("source_type") == "contact":
                return (
                    f"[{i+1}] CONTACT: {r.get('contact_name', r.get('sender', ''))} "
                    f"<{r.get('contact_email', '')}>\n"
                    f"    Notes: {r['text'][:800]}"
                )
            if r.get("source_type") == "document":
                return (
                    f"[{i+1}] DOCUMENT: {r.get('filename', 'unknown')}\n"
                    f"    Type: {r.get('file_type', '').upper()}\n"
                    f"    Content: {r['text'][:1500]}"
                )
            # Fetch full email body from SQLite so signatures aren't cut off by chunk size
            email_body = r.get("text", "")
            full_msg = cache.get(r["email_id"])
            if full_msg:
                raw = (full_msg.body or "").strip()
                if not raw and full_msg.body_html:
                    raw = re.sub(r'<[^>]+>', ' ', full_msg.body_html)
                    raw = re.sub(r'\s+', ' ', raw).strip()
                if raw:
                    email_body = raw
            return (
                f"[{i+1}] EMAIL — Subject: {r['subject']}\n"
                f"    From: {r['sender']}\n"
                f"    Date: {r['date']}\n"
                f"    Body: {email_body[:1500]}"
            )

        # Show up to 3 contacts + 5 documents + 8 emails in context
        contact_results = [r for r in results if r.get("source_type") == "contact"][:3]
        doc_results     = [r for r in results if r.get("source_type") == "document"][:5]
        email_results   = [r for r in results if r.get("source_type") not in ("document", "contact")][:8]
        ordered = contact_results + doc_results + email_results
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

        if is_aggregation:
            # Aggregation queries: answer entirely from DB facts, no email context needed
            user_content = f"{db_fact}\n\nQUESTION: {question}"
        elif context:
            user_content = (
                f"CONTEXT ({source_desc.upper()}):\n{context}"
                f"{db_fact}\n\n"
                f"QUESTION: {question}"
            )
        else:
            user_content = f"{db_fact}\n\nQUESTION: {question}"

        messages.append({"role": "user", "content": user_content})

        answer_tokens: list[str] = []
        error_occurred = False
        try:
            async with ai.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=1200,
                system=(
                    f"You are an executive assistant with access to a database of {source_desc}. "
                    f"Answer based ONLY on the {source_desc} shown. Pay close attention to email "
                    f"signatures — they often contain job titles, phone numbers, and company names. "
                    f"Be concise and specific."
                ),
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    answer_tokens.append(text)
                    yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"
        except Exception as e:
            error_occurred = True
            msg = str(e).lower()
            if "credit balance" in msg or "billing" in msg or "purchase credits" in msg:
                err_text = "⚠️ AI credits exhausted — please top up your Anthropic account at console.anthropic.com/settings/billing"
            elif "no streaming-capable provider" in msg or "no ai provider" in msg:
                err_text = "⚠️ No AI provider configured — add one in Settings → AI Providers"
            else:
                err_text = f"Error generating answer: {e}"
            yield f"data: {json.dumps({'type': 'token', 'text': err_text})}\n\n"

        if error_occurred:
            yield 'data: {"type":"done"}\n\n'
            return

        sources = []
        for r in results[:8]:
            # Convert cosine distance (0=identical, 1=orthogonal) to relevance %
            distance = r.get("_distance", 0.5)
            relevance_pct = round(max(0.0, min(1.0, 1.0 - distance)) * 100)

            # Extract a short snippet from the result text
            raw_text = r.get("text", "")
            snippet = raw_text.replace("\n", " ").strip()[:180] if raw_text else ""

            src: dict = {
                "email_id": r["email_id"],
                "source_type": r.get("source_type", "email"),
                "subject": r.get("subject", ""),
                "sender": r.get("sender", ""),
                "date": r.get("date", ""),
                "relevance_pct": relevance_pct,
                "snippet": snippet,
            }
            if r.get("source_type") == "document":
                src["filename"] = r.get("filename", "")
                src["file_type"] = r.get("file_type", "")
            elif r.get("source_type") == "contact":
                src["contact_email"] = r.get("contact_email", "")
                src["contact_name"] = r.get("contact_name", "")
            sources.append(src)
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
        yield 'data: {"type":"done"}\n\n'

        # Auto-save Q&A to history after streaming completes
        if answer_tokens:
            full_answer = "".join(answer_tokens)
            try:
                cache.save_ask_history(question, full_answer, json.dumps(sources))
            except Exception:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class ExplainClusterRequest(BaseModel):
    email_ids: List[str]
    question: Optional[str] = None

    @field_validator("email_ids")
    @classmethod
    def validate_ids(cls, v: List[str]) -> List[str]:
        if len(v) < 2:
            raise ValueError("Select at least 2 emails")
        if len(v) > 50:
            raise ValueError("Too many emails selected (max 50)")
        return v


@router.post("/explain-cluster")
async def explain_cluster(req: ExplainClusterRequest, request: Request):
    """Stream an AI explanation of what a user-selected set of emails have in common."""
    cache = request.app.state.cache
    ai = request.app.state.advisor.ai

    loop = asyncio.get_event_loop()

    def _fetch_emails():
        rows = []
        for eid in req.email_ids[:50]:
            msg = cache.get(eid)
            if msg:
                rows.append(msg)
        return rows

    async def generate():
        emails = await loop.run_in_executor(None, _fetch_emails)
        if len(emails) < 2:
            yield 'data: {"type":"token","text":"Could not find the selected emails."}\n\n'
            yield 'data: {"type":"done"}\n\n'
            return

        lines = "\n".join(
            f"- Subject: {e.subject or '(no subject)'}  |  From: {e.sender}  |  Preview: {(e.body or '')[:200].replace(chr(10),' ')}"
            for e in emails
        )
        extra = f"\n\nSpecific question: {req.question}" if req.question else ""
        prompt = (
            f"The user selected {len(emails)} emails from their inbox. "
            f"Analyze what they have in common — shared topics, senders, urgency, or themes. "
            f"Be concise and insightful (2-4 sentences).{extra}\n\nEMAILS:\n{lines}"
        )

        try:
            async with ai.messages.stream(
                max_tokens=400,
                system="You are an expert email analyst. Identify patterns and commonalities in emails.",
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                async for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"
        except Exception as e:
            msg = str(e).lower()
            if "credit balance" in msg or "billing" in msg or "purchase credits" in msg:
                err_text = "⚠️ AI credits exhausted — please top up your Anthropic account"
            else:
                err_text = f"Error: {e}"
            yield f"data: {json.dumps({'type': 'token', 'text': err_text})}\n\n"

        yield 'data: {"type":"done"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/docs-only")
async def ask_docs(request: Request):
    """Answer a question using only the document knowledge base (not email history)."""
    import json as _json
    from fastapi import HTTPException
    from services.rag_engine import RAGEngine
    from services.email_cache import EmailCache
    body_bytes = await request.body()
    try:
        data = _json.loads(body_bytes)
        question = data.get("question", "")
        n_results = min(int(data.get("n_results", 8)), 20)
    except Exception:
        raise HTTPException(400, "Invalid body")
    if not question.strip():
        raise HTTPException(400, "question required")

    rag: RAGEngine = request.app.state.rag
    advisor = request.app.state.advisor

    # Documents only
    doc_results = rag.semantic_search(question, n=n_results)
    docs = [r for r in doc_results if r.get("source_type") == "document"]

    if not docs:
        return {"answer": "No relevant documents found in your knowledge base.", "sources": []}

    context = "\n\n".join(
        f"[Document: {d.get('subject','Untitled')}]\n{d.get('text','')[:600]}"
        for d in docs[:5]
    )
    prompt = f"""Answer this question using ONLY the provided documents. \nIf the answer is not in the documents, say so clearly.\n\nQUESTION: {question}\n\nDOCUMENTS:\n{context}\n\nGive a direct, factual answer with the document name as source."""

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(model="claude-sonnet-4-6", max_tokens=600,
                messages=[{"role": "user", "content": prompt}])
            answer = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(model="claude-sonnet-4-6", max_tokens=600,
                messages=[{"role": "user", "content": prompt}])
            answer = resp.content[0].text.strip()
    except Exception as e:
        answer = f"Error generating answer: {e}"

    sources = [{"filename": d.get("subject", "Unknown"), "snippet": (d.get("text") or "")[:120]}
               for d in docs[:3]]
    return {"answer": answer, "sources": sources}
