import json
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/ask", tags=["ask"])


class AskRequest(BaseModel):
    question: str
    n_results: int = 15


@router.post("")
async def ask_db(req: AskRequest, request: Request):
    rag = request.app.state.rag
    ai = request.app.state.advisor.ai

    question = req.question.strip()
    if not question:
        return {"answer": "Please enter a question.", "sources": []}

    results = rag.hybrid_search(question, n_results=req.n_results)
    if not results:
        return {
            "answer": "No emails found in the database. Try ingesting some emails first.",
            "sources": [],
        }

    context = "\n\n".join(
        f"[{i+1}] Subject: {r['subject']}\n"
        f"    From: {r['sender']}\n"
        f"    Date: {r['date']}\n"
        f"    Preview: {r['text'][:500]}"
        for i, r in enumerate(results[:10])
    )

    prompt = (
        f"You are an assistant with access to an email database. "
        f"Answer the user's question based ONLY on the emails shown below. "
        f"Be concise and specific. If the answer isn't in the emails, say so.\n\n"
        f"EMAILS:\n{context}\n\n"
        f"QUESTION: {question}\n\n"
        f'Return a JSON object: {{"answer": "your answer here", "source_indices": [1, 2, ...]}} '
        f"where source_indices lists which email numbers (1-indexed) you used. "
        f"Return ONLY valid JSON."
    )

    try:
        resp = await ai.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        parsed = json.loads(raw)
        answer = parsed.get("answer", raw)
        indices = parsed.get("source_indices", [])
        sources = [
            {
                "email_id": results[i - 1]["email_id"],
                "subject": results[i - 1]["subject"],
                "sender": results[i - 1]["sender"],
                "date": results[i - 1]["date"],
            }
            for i in indices
            if isinstance(i, int) and 1 <= i <= len(results)
        ]
    except Exception as e:
        answer = f"Error generating answer: {e}"
        sources = []

    return {"answer": answer, "sources": sources}
