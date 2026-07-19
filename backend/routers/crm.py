"""Email-native CRM — deal pipeline with AI extraction."""

import json
from datetime import date, datetime
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


def collect_occasions(cache, days: int = 7) -> list[dict]:
    """Return contacts whose birthday or work anniversary (by month-day) falls
    within the next `days` days (inclusive of today). Dates stored as YYYY-MM-DD."""
    days = max(0, min(int(days or 0), 366))
    with cache._conn() as conn:
        try:
            rows = conn.execute(
                "SELECT email_addr, name, COALESCE(birthday,'') AS birthday, "
                "COALESCE(work_anniversary,'') AS work_anniversary FROM imported_contacts "
                "WHERE COALESCE(birthday,'') != '' OR COALESCE(work_anniversary,'') != ''"
            ).fetchall()
        except Exception:
            return []

    today = date.today()
    out: list[dict] = []
    for r in rows:
        for kind, raw in (("birthday", r["birthday"]), ("anniversary", r["work_anniversary"])):
            md = _month_day(raw)
            if md is None:
                continue
            away = _days_until(today, md)
            if away is not None and away <= days:
                out.append({
                    "name": r["name"] or r["email_addr"],
                    "email": r["email_addr"],
                    "type": kind,
                    "date": raw,
                    "days_away": away,
                })
    out.sort(key=lambda o: o["days_away"])
    return out


def _month_day(raw: str) -> Optional[tuple[int, int]]:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%m-%d", "%m/%d", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            return (dt.month, dt.day)
        except ValueError:
            continue
    return None


def _days_until(today: date, md: tuple[int, int]) -> Optional[int]:
    month, day = md
    # Handle Feb 29 on non-leap years by treating it as Feb 28
    for year in (today.year, today.year + 1):
        try:
            target = date(year, month, day)
        except ValueError:
            try:
                target = date(year, month, 28) if month == 2 else date(year, month, day)
            except ValueError:
                return None
        delta = (target - today).days
        if delta >= 0:
            return delta
    return None


@router.get("/upcoming-occasions")
async def upcoming_occasions(request: Request, days: int = 7):
    """Contacts with birthdays/anniversaries in the next `days` days."""
    cache = request.app.state.cache
    return {"occasions": collect_occasions(cache, days)}


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


ALLOWED_DEAL_FIELDS = {'name', 'stage', 'value', 'company', 'contact', 'notes', 'expected_close', 'probability'}


@router.patch("/deals/{deal_id}")
async def update_deal(deal_id: int, req: DealUpdate, request: Request):
    cache = request.app.state.cache
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    fields = {k: v for k, v in updates.items() if k in ALLOWED_DEAL_FIELDS}
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


def _ensure_crm_extras(cache):
    with cache._conn() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS crm_deal_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            deal_id INTEGER NOT NULL,
            email_id TEXT NOT NULL,
            direction TEXT CHECK(direction IN ('inbound','outbound')),
            logged_at TEXT DEFAULT (datetime('now')),
            UNIQUE(deal_id, email_id)
        )""")
    for col in ("email_count INTEGER DEFAULT 0", "last_email_at TEXT DEFAULT NULL", "next_followup_at TEXT DEFAULT NULL"):
        try:
            with cache._conn() as conn:
                conn.execute(f"ALTER TABLE crm_deals ADD COLUMN {col}")
        except Exception:
            pass


@router.get("/pipeline/kanban")
async def get_kanban(request: Request):
    cache = request.app.state.cache
    _ensure_crm_extras(cache)
    with cache._conn() as conn:
        deals = conn.execute(
            "SELECT id, name, contact_email, stage, value, notes, last_email_at FROM crm_deals ORDER BY created_at DESC"
        ).fetchall()
    columns: dict[str, list] = {}
    for d in deals:
        stage = d[3] or "prospect"
        columns.setdefault(stage, []).append({
            "id": d[0], "name": d[1], "contact_email": d[2],
            "stage": stage, "value": d[4], "notes": d[5], "last_email_at": d[6],
        })
    return {"columns": [{"stage": k, "deals": v} for k, v in columns.items()]}


@router.get("/deals/{deal_id}/emails")
async def get_deal_emails(deal_id: int, request: Request):
    cache = request.app.state.cache
    _ensure_crm_extras(cache)
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT de.email_id, e.subject, e.sender, e.date, de.direction "
            "FROM crm_deal_emails de LEFT JOIN emails e ON e.id=de.email_id "
            "WHERE de.deal_id=? ORDER BY de.logged_at DESC",
            (deal_id,),
        ).fetchall()
    return {"emails": [{"email_id": r[0], "subject": r[1], "sender": r[2], "date": r[3], "direction": r[4]} for r in rows]}


@router.post("/deals/{deal_id}/emails")
async def link_deal_email(deal_id: int, body: dict, request: Request):
    cache = request.app.state.cache
    _ensure_crm_extras(cache)
    email_id = str(body.get("email_id", ""))
    direction = body.get("direction", "inbound")
    if direction not in ("inbound", "outbound"):
        direction = "inbound"
    if not email_id:
        raise HTTPException(400, "email_id required")
    with cache._conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO crm_deal_emails (deal_id, email_id, direction) VALUES (?,?,?)",
            (deal_id, email_id, direction),
        )
        conn.execute("UPDATE crm_deals SET email_count=email_count+1, last_email_at=datetime('now') WHERE id=?", (deal_id,))
    return {"linked": True}


@router.delete("/deals/{deal_id}/emails/{email_id}")
async def unlink_deal_email(deal_id: int, email_id: str, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM crm_deal_emails WHERE deal_id=? AND email_id=?", (deal_id, email_id))
    return {"unlinked": True}


@router.post("/deals/{deal_id}/followup-draft")
async def crm_followup_draft(deal_id: int, request: Request):
    cache = request.app.state.cache
    advisor = request.app.state.advisor
    with cache._conn() as conn:
        deal = conn.execute("SELECT name, contact_email, stage, notes FROM crm_deals WHERE id=?", (deal_id,)).fetchone()
    if not deal:
        raise HTTPException(404, "Deal not found")
    prompt = (
        f"Write a brief, professional follow-up email for a deal named '{deal[0]}' "
        f"currently in the '{deal[2]}' stage. Contact: {deal[1]}. Context: {deal[3] or 'none'}. "
        "Return JSON with keys: to, subject, body."
    )
    try:
        result = await advisor._agentic_call(None, prompt)
        return result if isinstance(result, dict) else {"to": deal[1], "subject": f"Following up on {deal[0]}", "body": str(result)}
    except Exception as e:
        return {"to": deal[1] or "", "subject": f"Following up on {deal[0]}", "body": f"Hi,\n\nJust following up on {deal[0]}.\n\nBest regards"}
