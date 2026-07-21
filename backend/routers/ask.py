import asyncio
import json
import re
from typing import List, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from services.ask_intelligence import (
    COUNT_QUESTION, TOP_SENDER_QUESTION, RELATION_QUESTION, RECOMMENDATION_QUESTION,
    search_query, extract_sender_name, extract_two_names,
    build_top_sender_fact, build_volume_fact, build_relation_fact,
)

router = APIRouter(prefix="/api/ask", tags=["ask"])


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
    n_results: int = 25
    history: List[HistoryMessage] = []


@router.get("/history")
async def get_ask_history(
    request: Request,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
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
    cache = request.app.state.cache
    loop = asyncio.get_event_loop()
    entry_id = await loop.run_in_executor(
        None, lambda: cache.save_ask_history(req.question, req.answer, req.results_json or "[]")
    )
    return {"id": entry_id, "status": "saved"}


def _format_result(i: int, r: dict, cache) -> str:
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
            f"    Content: {r['text'][:2000]}"
        )
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
        f"    Body: {email_body[:2000]}"
    )


def _build_sources(results: list[dict]) -> list[dict]:
    sources = []
    for r in results[:12]:
        distance = r.get("_distance", 0.5)
        relevance_pct = round(max(0.0, min(1.0, 1.0 - distance)) * 100)
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
    return sources


def _pick_model(question: str, is_aggregation: bool) -> tuple[str, int]:
    """Choose AI model and max_tokens based on question type."""
    if is_aggregation:
        return "claude-haiku-4-5-20251001", 600
    if RECOMMENDATION_QUESTION.search(question):
        return "claude-sonnet-4-6", 2000
    # Synthesis / relationship queries benefit from sonnet
    if RELATION_QUESTION.search(question) or (
        "and" in question.lower() and "relat" in question.lower()
    ):
        return "claude-sonnet-4-6", 1500
    # Default: haiku for speed, sonnet for longer questions
    return "claude-haiku-4-5-20251001", 1200


def _system_prompt(source_desc: str, is_aggregation: bool, is_recommendation: bool) -> str:
    if is_aggregation:
        return (
            "You are an executive assistant. Answer factual questions about email statistics "
            "using ONLY the DB FACTS provided. State numbers precisely."
        )
    if is_recommendation:
        return (
            f"You are an expert executive assistant with deep knowledge of the user's "
            f"{source_desc}. Your job is to synthesize insights across ALL provided sources "
            f"and give actionable recommendations, suggested next steps, and strategic advice. "
            f"Draw connections between documents and emails. Be direct and practical. "
            f"When you make a recommendation, cite the source email or document that supports it."
        )
    return (
        f"You are an executive assistant with full access to the user's {source_desc}. "
        f"Synthesize information across ALL provided sources to give the most complete, "
        f"accurate answer. Pay close attention to email signatures (job titles, phones, companies). "
        f"If the exact answer isn't in the sources, say so clearly and share what IS known."
    )


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

        db_fact = ""
        is_aggregation = False
        extra_results: list[dict] = []
        loop = asyncio.get_event_loop()

        # --- Structured query detection: relationship / aggregation ---
        if RELATION_QUESTION.search(question) or (
            "and" in question.lower() and "relat" in question.lower()
        ):
            pair = extract_two_names(question)
            if pair:
                db_fact, extra_results = await loop.run_in_executor(
                    None, build_relation_fact, cache, pair[0], pair[1]
                )
                is_aggregation = not extra_results
        elif TOP_SENDER_QUESTION.search(question):
            is_aggregation = True
            db_fact = await loop.run_in_executor(None, build_top_sender_fact, cache, question)
        elif COUNT_QUESTION.search(question):
            sender_name = extract_sender_name(question)
            if sender_name:
                exact_count = cache.count_by_sender(sender_name)
                db_fact = (
                    f"\n\nDB FACT: There are exactly {exact_count} emails from "
                    f"'{sender_name}' in the database. Use this exact number."
                )
            else:
                is_aggregation = True
                db_fact = await loop.run_in_executor(None, build_volume_fact, cache, question)

        # --- Semantic search (unless pure aggregation) ---
        results = extra_results or []
        if not is_aggregation and not extra_results:
            results = await loop.run_in_executor(
                None, rag.hybrid_search, search_query(question), req.n_results
            )
        if not results and not is_aggregation:
            yield 'data: {"type":"token","text":"No emails or documents found in the database. Try importing emails or indexing a document folder first."}\n\n'
            yield 'data: {"type":"done"}\n\n'
            return

        # --- Build context (more results shown than before) ---
        contact_results = [r for r in results if r.get("source_type") == "contact"][:4]
        doc_results     = [r for r in results if r.get("source_type") == "document"][:8]
        email_results   = [r for r in results if r.get("source_type") not in ("document", "contact")][:12]
        ordered = contact_results + doc_results + email_results
        context = "\n\n".join(_format_result(i, r, cache) for i, r in enumerate(ordered))

        has_docs   = any(r.get("source_type") == "document" for r in results[:15])
        has_emails = any(r.get("source_type") != "document" for r in results[:15])
        source_desc = (
            "emails and documents" if has_docs and has_emails
            else "documents" if has_docs
            else "emails"
        )

        is_recommendation = bool(RECOMMENDATION_QUESTION.search(question))
        model, max_tokens = _pick_model(question, is_aggregation)
        system = _system_prompt(source_desc, is_aggregation, is_recommendation)

        # --- Build message ---
        messages = [{"role": h.role, "content": h.content} for h in req.history[-6:]]
        if is_aggregation:
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

        # --- Stream answer ---
        answer_tokens: list[str] = []
        error_occurred = False
        try:
            async with ai.messages.stream(
                model=model,
                max_tokens=max_tokens,
                system=system,
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

        sources = _build_sources(results)
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
        yield 'data: {"type":"done"}\n\n'

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
    cache = request.app.state.cache
    ai = request.app.state.advisor.ai
    loop = asyncio.get_event_loop()

    def _fetch_emails():
        return [cache.get(eid) for eid in req.email_ids[:50] if cache.get(eid)]

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
            if "credit balance" in msg or "billing" in msg:
                err_text = "⚠️ AI credits exhausted"
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
    import json as _json
    from fastapi import HTTPException
    body_bytes = await request.body()
    try:
        data = _json.loads(body_bytes)
        question = data.get("question", "")
        n_results = min(int(data.get("n_results", 8)), 20)
    except Exception:
        raise HTTPException(400, "Invalid body")
    if not question.strip():
        raise HTTPException(400, "question required")

    rag = request.app.state.rag
    advisor = request.app.state.advisor

    doc_results = rag.semantic_search(question, n=n_results)
    docs = [r for r in doc_results if r.get("source_type") == "document"]
    if not docs:
        return {"answer": "No relevant documents found in your knowledge base.", "sources": []}

    context = "\n\n".join(
        f"[Document: {d.get('subject','Untitled')}]\n{d.get('text','')[:600]}"
        for d in docs[:5]
    )
    prompt = (
        f"Answer this question using ONLY the provided documents.\n"
        f"If the answer is not in the documents, say so clearly.\n\n"
        f"QUESTION: {question}\n\nDOCUMENTS:\n{context}\n\n"
        f"Give a direct, factual answer with the document name as source."
    )

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        client = ant or advisor.ai
        resp = await client.messages.create(
            model="claude-sonnet-4-6", max_tokens=600,
            messages=[{"role": "user", "content": prompt}]
        )
        answer = resp.content[0].text.strip()
    except Exception as e:
        answer = f"Error generating answer: {e}"

    sources = [
        {"filename": d.get("subject", "Unknown"), "snippet": (d.get("text") or "")[:120]}
        for d in docs[:3]
    ]
    return {"answer": answer, "sources": sources}
