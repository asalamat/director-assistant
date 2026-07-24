import asyncio
import json
from typing import List, Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from services.ask_intelligence import (
    COUNT_QUESTION, TOP_SENDER_QUESTION, RELATION_QUESTION, RECOMMENDATION_QUESTION,
    search_query, extract_sender_name, extract_two_names,
    build_top_sender_fact, build_volume_fact, build_relation_fact,
    format_result, build_sources, pick_model, build_system_prompt,
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
    time_weighted: bool = True


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



async def _enrich_query(ai, question: str) -> tuple[str, list[str]]:
    """HyDE + query expansion in parallel. Returns (hyde_text, expanded_terms)."""
    async def _hyde() -> str:
        try:
            r = await ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=200,
                messages=[{"role": "user", "content": f"Write a short email (2-3 sentences) that would answer: {question}"}])
            return r.content[0].text.strip()
        except Exception:
            return ""

    async def _expand() -> list[str]:
        try:
            r = await ai.messages.create(model="claude-haiku-4-5-20251001", max_tokens=100,
                messages=[{"role": "user", "content": f"List 5 related search terms for: {question}\nOne per line, no explanations."}])
            return [ln.strip() for ln in r.content[0].text.strip().splitlines() if ln.strip()][:3]
        except Exception:
            return []

    return await asyncio.gather(_hyde(), _expand())


async def _rewrite_with_history(ai, question: str, history: list) -> str:
    """Resolve pronouns/context from recent turns into a standalone search query."""
    if not history:
        return question
    convo = "\n".join(f"{h.role}: {h.content}" for h in history[-4:])
    try:
        resp = await ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=120,
            messages=[{"role": "user", "content":
                f"Given this conversation:\n{convo}\n\nRewrite this follow-up into a standalone search query "
                f"resolving any pronouns/references. Return ONLY the rewritten query.\n\nFollow-up: {question}"}],
        )
        out = resp.content[0].text.strip()
        return out or question
    except Exception:
        return question


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
        relation_pair: tuple | None = None
        if RELATION_QUESTION.search(question) or (
            "and" in question.lower() and "relat" in question.lower()
        ):
            relation_pair = extract_two_names(question)
            if relation_pair:
                db_fact, extra_results = await loop.run_in_executor(
                    None, build_relation_fact, cache, relation_pair[0], relation_pair[1]
                )
                # Never set is_aggregation here — always fall through to RAG
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

        # --- Semantic search: always runs except for pure stat aggregations ---
        results = list(extra_results)
        if not is_aggregation:
            seen_ids = {r.get("email_id") for r in results}

            if relation_pair:
                # Search each name separately — same as "who is Hannah" which already works.
                # Two separate searches give better recall than one combined query.
                for name in relation_pair:
                    name_results = await loop.run_in_executor(
                        None, rag.hybrid_search, name, req.n_results // 2
                    )
                    for r in name_results:
                        if r.get("email_id") not in seen_ids:
                            results.append(r)
                            seen_ids.add(r.get("email_id"))
            else:
                resolved_q = await _rewrite_with_history(ai, question, req.history)
                base_query = search_query(resolved_q)

                hyde_text, expanded_terms = await _enrich_query(ai, resolved_q)
                enriched_parts = [base_query]
                if hyde_text:
                    enriched_parts.append(hyde_text[:300])
                if expanded_terms:
                    enriched_parts.append(" ".join(expanded_terms))
                rag_results = await loop.run_in_executor(
                    None, rag.hybrid_search, " ".join(enriched_parts), req.n_results,
                    req.time_weighted,
                )
                for r in rag_results:
                    if r.get("email_id") not in seen_ids:
                        results.append(r)
                        seen_ids.add(r.get("email_id"))

                if results:
                    hop_parts = [
                        v for r in results[:3]
                        for v in (r.get("subject", ""), r.get("sender", "")) if v
                    ]
                    if hop_parts:
                        hop_results = await loop.run_in_executor(
                            None, rag.hybrid_search, " ".join(hop_parts[:6]),
                            req.n_results // 2, req.time_weighted,
                        )
                        for r in hop_results:
                            if r.get("email_id") not in seen_ids:
                                results.insert(0, r)
                                seen_ids.add(r.get("email_id"))
        if not results and not is_aggregation:
            yield 'data: {"type":"token","text":"No emails or documents found in the database. Try importing emails or indexing a document folder first."}\n\n'
            yield 'data: {"type":"done"}\n\n'
            return

        # --- Build context (more results shown than before) ---
        contact_results = [r for r in results if r.get("source_type") == "contact"][:4]
        doc_results     = [r for r in results if r.get("source_type") == "document"][:8]
        email_results   = [r for r in results if r.get("source_type") not in ("document", "contact")][:12]
        ordered = contact_results + doc_results + email_results
        context = "\n\n".join(format_result(i, r, cache) for i, r in enumerate(ordered))

        has_docs   = any(r.get("source_type") == "document" for r in results[:15])
        has_emails = any(r.get("source_type") != "document" for r in results[:15])
        source_desc = (
            "emails and documents" if has_docs and has_emails
            else "documents" if has_docs
            else "emails"
        )

        is_recommendation = bool(RECOMMENDATION_QUESTION.search(question))
        model, max_tokens = pick_model(question, is_aggregation)
        system = build_system_prompt(source_desc, is_aggregation, is_recommendation)

        # Conversation memory: prepend last 3 Q/A pairs to system context
        hist = req.history[-6:]
        conv_lines = [
            f"Previous Q: {hist[i].content[:200].replace(chr(10),' ')}\n"
            f"Previous A: {hist[i+1].content[:200].replace(chr(10),' ')}"
            for i in range(0, len(hist) - 1, 2)
            if hist[i].role == "user" and hist[i + 1].role == "assistant"
        ]
        if conv_lines:
            system = f"CONVERSATION HISTORY:\n{chr(10).join(conv_lines[-3:])}\n\n{system}"

        # For relationship questions, add an explicit instruction so the AI
        # synthesizes what it finds rather than saying "I don't have enough info"
        if relation_pair:
            system += (
                f" The user is specifically asking about the relationship between "
                f"'{relation_pair[0]}' and '{relation_pair[1]}'. "
                f"Describe how they know each other, what they work on together, "
                f"how often they interact, and any notable context — inferred from "
                f"the emails and documents shown. Do not say 'I cannot determine' "
                f"if ANY relevant content is visible."
            )

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

        sources = build_sources(results)
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
