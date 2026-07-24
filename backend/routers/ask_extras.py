"""Secondary ask endpoints — explain-cluster and docs-only."""

import asyncio
import json
import re
from typing import List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/api/ask", tags=["ask"])


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
            f"- Subject: {e.subject or '(no subject)'}  |  From: {e.sender}  |  "
            f"Preview: {(e.body or '')[:200].replace(chr(10),' ')}"
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
            err_text = "⚠️ AI credits exhausted" if ("credit balance" in msg or "billing" in msg) else f"Error: {e}"
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
