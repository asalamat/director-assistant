"""Email-native CRM — deal pipeline with AI extraction."""

import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

router = APIRouter(prefix="/api/crm", tags=["crm"])

VALID_STAGES = {"prospect", "active", "negotiating", "won", "lost"}


class DealCreate(BaseModel):
    name: str
    contact_email: str = ""
    stage: str = "prospect"
    value: str = ""
    notes: str = ""

    @field_validator("stage")
    @classmethod
    def check_stage(cls, v: str) -> str:
        if v not in VALID_STAGES:
            raise ValueError(f"stage must be one of {sorted(VALID_STAGES)}")
        return v


class DealUpdate(BaseModel):
    name: Optional[str] = None
    contact_email: Optional[str] = None
    stage: Optional[str] = None
    value: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("stage")
    @classmethod
    def check_stage(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_STAGES:
            raise ValueError(f"stage must be one of {sorted(VALID_STAGES)}")
        return v


@router.get("/deals")
async def list_deals(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT * FROM crm_deals ORDER BY updated_at DESC"
        ).fetchall()
    return {"deals": [dict(r) for r in rows]}


# /extract must be registered BEFORE /{deal_id} to avoid FastAPI routing conflict
@router.post("/deals/extract")
async def extract_deals(request: Request):
    """AI scans recent emails and suggests deal entries."""
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT subject, sender, body FROM emails ORDER BY date DESC LIMIT 200"
        ).fetchall()

    snippets = []
    for r in rows[:50]:
        subj = (r["subject"] or "")[:80]
        sender = (r["sender"] or "")[:50]
        snip = (r["body"] or "")[:200].replace("\n", " ")
        snippets.append(f"Subject: {subj} | From: {sender} | Snippet: {snip}")

    prompt = (
        "You are a CRM assistant. Analyse the following email excerpts and identify potential business deals or opportunities.\n\n"
        + "\n".join(snippets[:40])
        + "\n\nReturn a JSON array of deal suggestions (max 8). Each item: "
        '{"name": "deal name", "contact_email": "email if found else \'\'", "stage": "prospect", "value": "estimated value or \'\'", "notes": "1-sentence context"}. '
        "Return ONLY valid JSON, no markdown."
    )

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=1000,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
        s, e = raw.find("["), raw.rfind("]") + 1
        suggestions = json.loads(raw[s:e]) if s >= 0 else []
    except Exception:
        suggestions = []

    return {"suggestions": suggestions}


@router.post("/deals")
async def create_deal(req: DealCreate, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        cur = conn.execute(
            "INSERT INTO crm_deals (name, contact_email, stage, value, notes) VALUES (?,?,?,?,?)",
            (req.name, req.contact_email, req.stage, req.value, req.notes),
        )
    return {"id": cur.lastrowid, "status": "created"}


@router.patch("/deals/{deal_id}")
async def update_deal(deal_id: int, req: DealUpdate, request: Request):
    cache = request.app.state.cache
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")

    with cache._conn() as conn:
        # Get current stage before update (for history log)
        current = conn.execute("SELECT stage FROM crm_deals WHERE id = ?", (deal_id,)).fetchone()
        if not current:
            raise HTTPException(404, "Deal not found")
        old_stage = current["stage"]

        set_clause = ", ".join(f"{k} = ?" for k in fields) + ", updated_at = datetime('now')"
        conn.execute(
            f"UPDATE crm_deals SET {set_clause} WHERE id = ?",
            (*fields.values(), deal_id),
        )

        # Log stage change to history
        if "stage" in fields and fields["stage"] != old_stage:
            conn.execute(
                "INSERT INTO crm_deal_history (deal_id, from_stage, to_stage) VALUES (?,?,?)",
                (deal_id, old_stage, fields["stage"]),
            )

    return {"status": "updated"}


@router.get("/deals/{deal_id}/history")
async def get_deal_history(deal_id: int, request: Request):
    """Return stage change history for a deal."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT from_stage, to_stage, changed_at, note FROM crm_deal_history "
            "WHERE deal_id = ? ORDER BY changed_at DESC",
            (deal_id,),
        ).fetchall()
    return {"history": [dict(r) for r in rows]}


@router.delete("/deals/{deal_id}")
async def delete_deal(deal_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        cur = conn.execute("DELETE FROM crm_deals WHERE id = ?", (deal_id,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Deal not found")
    return {"status": "deleted"}
