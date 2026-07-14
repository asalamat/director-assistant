"""Email Autopilot — manage rules and trigger AI replies for defined senders."""
import logging

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from services.autopilot_engine import (
    _retry_queue, _extract_email_addr, _generate_reply,
    handle_incoming_email, _save_draft, _send_reply, _log_activity,
)

router = APIRouter(prefix="/api/autopilot", tags=["autopilot"])
_log = logging.getLogger(__name__)


class RuleIn(BaseModel):
    email_addr: str
    display_name: str = ''
    mode: str = 'draft'   # 'reply' | 'draft' | 'off'
    prompt_hint: str = ''


class RuleUpdate(BaseModel):
    mode: str
    prompt_hint: str = ''


@router.get("/rules")
async def list_rules(request: Request):
    rules = request.app.state.cache.list_autopilot_rules()
    return {"rules": rules}


@router.post("/rules")
async def add_rule(req: RuleIn, request: Request):
    if not req.email_addr.strip():
        raise HTTPException(400, "email_addr required")
    if req.mode not in ('reply', 'draft', 'off'):
        raise HTTPException(400, "mode must be reply|draft|off")
    rule_id = request.app.state.cache.upsert_autopilot_rule(
        req.email_addr, req.display_name, req.mode, req.prompt_hint
    )
    return {"id": rule_id, "status": "saved"}


@router.put("/rules/{rule_id}")
async def update_rule(rule_id: int, req: RuleUpdate, request: Request):
    if req.mode not in ('reply', 'draft', 'off'):
        raise HTTPException(400, "mode must be reply|draft|off")
    ok = request.app.state.cache.update_autopilot_rule(rule_id, req.mode, req.prompt_hint)
    if not ok:
        raise HTTPException(404, "Rule not found")
    return {"status": "updated"}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: int, request: Request):
    ok = request.app.state.cache.delete_autopilot_rule(rule_id)
    if not ok:
        raise HTTPException(404, "Rule not found")
    return {"status": "deleted"}


@router.get("/activity")
async def get_activity(request: Request):
    """Return the last 50 autopilot actions (drafts/replies)."""
    cache = request.app.state.cache
    try:
        with cache._conn() as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS autopilot_activity (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email_id TEXT, sender TEXT, subject TEXT,
                    action TEXT, created_at TEXT
                )"""
            )
            rows = conn.execute(
                "SELECT * FROM autopilot_activity ORDER BY id DESC LIMIT 50"
            ).fetchall()
        return {"activity": [dict(r) for r in rows]}
    except Exception as e:
        return {"activity": [], "error": str(e)}


@router.get("/debug/{email_id}")
async def debug_context(email_id: str, request: Request):
    """Return the raw context that would be passed to the AI for this email (no AI call)."""
    import re as _re
    cache = request.app.state.cache
    email = cache.get(email_id)
    if not email:
        try:
            with cache._conn() as conn:
                row = conn.execute("SELECT * FROM emails WHERE id = ?", (email_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Email not found")
            class _E:
                pass
            email = _E()
            for k in row.keys():
                setattr(email, k, row[k])
        except Exception as exc:
            raise HTTPException(404, str(exc))

    original_body = (email.body or "").strip()
    subject_stem = (email.subject or "").lstrip("Re: ").lstrip("Fw: ").strip()
    thread_rows = []
    fts_hits = {}
    try:
        with cache._conn() as conn:
            thread_rows = conn.execute(
                "SELECT subject, sender, date, body FROM emails WHERE id != ? AND (subject = ? OR subject LIKE ? OR subject LIKE ?) ORDER BY date ASC LIMIT 8",
                (email_id, subject_stem, f"Re: {subject_stem}", f"Fw: {subject_stem}"),
            ).fetchall()
    except Exception:
        pass
    thread_text = " ".join((r["body"] or "")[:200] for r in thread_rows[-3:])
    name_tokens = list(dict.fromkeys(
        _re.findall(r'\b[A-Z][a-z]{2,}\b', f"{email.subject} {original_body[:400]} {thread_text[:800]}")
    ))[:8]
    try:
        if name_tokens:
            with cache._conn() as conn:
                for tok in name_tokens[:4]:
                    like_rows = conn.execute(
                        "SELECT id, subject, sender, substr(body,1,300) as body FROM emails WHERE id != ? AND (body LIKE ? OR subject LIKE ?) LIMIT 3",
                        (email_id, f"%{tok}%", f"%{tok}%"),
                    ).fetchall()
                    for row in like_rows:
                        fts_hits[row["id"]] = dict(row)
    except Exception:
        pass
    return {
        "email_id": email_id,
        "subject": email.subject,
        "body_preview": original_body[:200],
        "thread_count": len(thread_rows),
        "thread_subjects": [r["subject"] for r in thread_rows],
        "name_tokens": name_tokens,
        "context_hits": [{"id": k, "subject": v["subject"], "body": v["body"][:150]} for k, v in list(fts_hits.items())[:5]],
    }


@router.post("/trigger/{email_id}")
async def trigger_reply(email_id: str, request: Request):
    """Force-run autopilot on a specific email regardless of whether it was already processed."""
    cache = request.app.state.cache
    rag = request.app.state.rag
    ai = request.app.state.advisor.ai
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    sender_email = _extract_email_addr(email.sender or "")
    rule = cache.get_autopilot_rule_by_email(sender_email)
    mode = (rule or {}).get("mode", "draft")
    if mode == "off":
        mode = "draft"
    prompt_hint = (rule or {}).get("prompt_hint", "")

    draft_body = await _generate_reply(email, cache, rag, ai, prompt_hint=prompt_hint)
    if not draft_body:
        raise HTTPException(500, "AI reply generation failed")

    if mode == "reply":
        _send_reply(email, draft_body, cache)
        return {"status": "sent", "mode": "reply"}
    else:
        _save_draft(email, draft_body, cache)
        _log_activity(email, "draft_saved", cache)
        return {"status": "draft_saved", "mode": "draft", "preview": draft_body[:200]}


@router.post("/preview/{email_id}")
async def preview_reply(email_id: str, request: Request):
    """Generate a preview of what the autopilot reply would look like."""
    cache = request.app.state.cache
    rag = request.app.state.rag
    ai = request.app.state.advisor.ai
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")
    draft = await _generate_reply(email, cache, rag, ai, prompt_hint="")
    return {"draft": draft, "email_id": email_id}
