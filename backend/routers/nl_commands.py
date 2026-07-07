"""Natural-language inbox commands.

Two-phase flow: parse (AI interprets the command, builds a preview, no writes)
then execute (user-confirmed; applies the action via existing cache methods).

Security: the AI-suggested action is always validated against ALLOWED_ACTIONS
before any DB operation — raw AI output is never executed. Deletes are capped
server-side.
"""

import json as _json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from services.email_cache import EmailCache

router = APIRouter(prefix="/api/emails/nl-command", tags=["nl-commands"])

# Actions the AI is allowed to request. Validated before any write.
ALLOWED_ACTIONS = {"archive", "mark_read", "mark_unread", "label", "snooze", "delete"}
UNDOABLE_ACTIONS = {"archive"}
DELETE_CAP = 50
PREVIEW_LIMIT = 200

_SYSTEM_PROMPT = (
    "You translate a natural-language inbox command into a structured JSON action.\n"
    "Return ONLY JSON, no prose. Schema:\n"
    '{"action": "archive|mark_read|mark_unread|label|snooze|delete", '
    '"sender_filter": "substring of sender or null", '
    '"subject_contains": "substring of subject or null", '
    '"date_range": {"from": "YYYY-MM-DD or null", "to": "YYYY-MM-DD or null"} or null, '
    '"folder": "folder name to scope to, e.g. INBOX, or null", '
    '"label": "category name when action is label, else null"}\n'
    "Rules: action MUST be one of the six listed verbs. "
    "Use null for anything not specified. Do not invent filters."
)


def _ensure_tables(cache: EmailCache) -> None:
    with cache._conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS nl_command_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command_text TEXT NOT NULL,
                parsed_action TEXT NOT NULL,
                executed INTEGER DEFAULT 0,
                affected_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )


class ParseRequest(BaseModel):
    command: str = Field(..., max_length=500)


class ExecuteRequest(BaseModel):
    command_id: int


class UndoRequest(BaseModel):
    command_id: int


def _build_preview_query(filters: dict) -> tuple[str, list]:
    """Build a read-only SELECT for the affected emails from validated filters."""
    where = []
    params: list = []

    folder = filters.get("folder")
    if folder:
        where.append("folder = ?")
        params.append(folder)

    sender = filters.get("sender_filter")
    if sender:
        where.append("sender LIKE ?")
        params.append(f"%{sender}%")

    subject = filters.get("subject_contains")
    if subject:
        where.append("subject LIKE ?")
        params.append(f"%{subject}%")

    date_range = filters.get("date_range") or {}
    if date_range.get("from"):
        where.append("date >= ?")
        params.append(date_range["from"])
    if date_range.get("to"):
        where.append("date <= ?")
        params.append(date_range["to"])

    clause = (" WHERE " + " AND ".join(where)) if where else ""
    sql = (
        "SELECT id, subject, sender, date FROM emails"
        + clause
        + " ORDER BY date DESC LIMIT ?"
    )
    params.append(PREVIEW_LIMIT)
    return sql, params


async def _parse_with_ai(advisor, command: str) -> dict:
    prompt = f'{_SYSTEM_PROMPT}\n\nCommand: "{command}"'
    ant = getattr(advisor.ai, "_anthropic", None)
    if ant:
        resp = await ant.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=300,
            messages=[{"role": "user", "content": prompt}])
    else:
        resp = await advisor.ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=300,
            messages=[{"role": "user", "content": prompt}])
    text = resp.content[0].text.strip()
    s, e = text.find("{"), text.rfind("}") + 1
    if s < 0:
        raise ValueError("AI returned no JSON")
    return _json.loads(text[s:e])


@router.post("/parse")
async def parse_command(req: ParseRequest, request: Request):
    """Interpret an NL command, preview affected emails, log it (executed=0)."""
    command = req.command.strip()
    if not command:
        raise HTTPException(422, "command must not be empty")

    cache: EmailCache = request.app.state.cache
    advisor = request.app.state.advisor
    _ensure_tables(cache)

    try:
        parsed = await _parse_with_ai(advisor, command)
    except Exception as exc:
        raise HTTPException(422, f"Could not interpret command: {exc}")

    action = parsed.get("action")
    # CRITICAL: validate against allowlist before doing anything else.
    if action not in ALLOWED_ACTIONS:
        raise HTTPException(422, f"Unsupported action: {action!r}")

    filters = {
        "sender_filter": parsed.get("sender_filter"),
        "subject_contains": parsed.get("subject_contains"),
        "date_range": parsed.get("date_range"),
        "folder": parsed.get("folder"),
        "label": parsed.get("label"),
    }

    sql, params = _build_preview_query(filters)
    with cache._conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    preview = [
        {"id": r["id"], "subject": r["subject"] or "(no subject)",
         "sender": r["sender"] or "", "date": r["date"]}
        for r in rows
    ]
    safe = action != "delete"

    with cache._conn() as conn:
        cur = conn.execute(
            "INSERT INTO nl_command_log (command_text, parsed_action) VALUES (?, ?)",
            (command, _json.dumps({"action": action, "filters": filters})),
        )
        command_id = cur.lastrowid

    return {
        "action": action,
        "filters": filters,
        "preview": preview,
        "count": len(preview),
        "safe": safe,
        "command_id": command_id,
    }


@router.post("/execute")
async def execute_command(req: ExecuteRequest, request: Request):
    """Apply a previously-parsed command. Re-validates the action against the allowlist."""
    cache: EmailCache = request.app.state.cache
    rag = request.app.state.rag
    _ensure_tables(cache)

    with cache._conn() as conn:
        row = conn.execute(
            "SELECT parsed_action, executed FROM nl_command_log WHERE id = ?",
            (req.command_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Command not found")
    if row["executed"]:
        raise HTTPException(409, "Command already executed")

    parsed = _json.loads(row["parsed_action"])
    action = parsed.get("action")
    filters = parsed.get("filters") or {}

    # CRITICAL: re-validate even though parse validated — never trust stored data blindly.
    if action not in ALLOWED_ACTIONS:
        raise HTTPException(422, f"Unsupported action: {action!r}")

    sql, params = _build_preview_query(filters)
    with cache._conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    email_ids = [r["id"] for r in rows]

    if action == "delete":
        email_ids = email_ids[:DELETE_CAP]

    affected: list[str] = []

    if action == "mark_read":
        with cache._conn() as conn:
            for eid in email_ids:
                conn.execute("UPDATE emails SET is_read = 1 WHERE id = ?", (eid,))
                affected.append(eid)
    elif action == "mark_unread":
        with cache._conn() as conn:
            for eid in email_ids:
                conn.execute("UPDATE emails SET is_read = 0 WHERE id = ?", (eid,))
                affected.append(eid)
    elif action == "archive":
        with cache._conn() as conn:
            for eid in email_ids:
                if conn.execute(
                    "UPDATE emails SET folder = 'Archive' WHERE id = ?", (eid,)
                ).rowcount:
                    affected.append(eid)
    elif action == "label":
        label = filters.get("label") or "Labeled"
        for eid in email_ids:
            cache.set_category(eid, label)
            affected.append(eid)
    elif action == "snooze":
        for eid in email_ids:
            cache.snooze_email(eid, set_aside=True)
            affected.append(eid)
    elif action == "delete":
        for eid in email_ids:
            found = cache.delete_email(eid)
            rag.remove_email(eid)
            if found:
                affected.append(eid)

    with cache._conn() as conn:
        conn.execute(
            "UPDATE nl_command_log SET executed = 1, affected_count = ? WHERE id = ?",
            (len(affected), req.command_id),
        )

    return {"executed": len(affected), "action": action, "email_ids": affected}


@router.post("/undo")
async def undo_command(req: UndoRequest, request: Request):
    """Undo a command. Only archive is reversible (un-archive back to INBOX)."""
    cache: EmailCache = request.app.state.cache
    _ensure_tables(cache)

    with cache._conn() as conn:
        row = conn.execute(
            "SELECT parsed_action, executed FROM nl_command_log WHERE id = ?",
            (req.command_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Command not found")
    if not row["executed"]:
        raise HTTPException(409, "Command was not executed")

    parsed = _json.loads(row["parsed_action"])
    action = parsed.get("action")
    if action not in UNDOABLE_ACTIONS:
        return {"undone": 0, "message": f"{action} cannot be undone"}

    filters = parsed.get("filters") or {}
    # Re-match against the archived set using the same filters, now in Archive.
    undo_filters = dict(filters)
    undo_filters["folder"] = "Archive"
    sql, params = _build_preview_query(undo_filters)
    with cache._conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        undone = 0
        for r in rows:
            if conn.execute(
                "UPDATE emails SET folder = 'INBOX' WHERE id = ?", (r["id"],)
            ).rowcount:
                undone += 1

    return {"undone": undone, "message": f"Restored {undone} email(s) to INBOX"}
