"""Commitment Tracker — promises you owe vs. promises owed to you, extracted from email threads."""

import json
import re
from typing import Optional, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/commitments", tags=["commitments"])

_ID_RE = re.compile(r"[^A-Za-z0-9._@<>:+\-/=]")


def _safe_email_id(email_id: str) -> str:
    """Strip characters that should never appear in a stored message id before
    using it in an AI prompt or further processing."""
    return _ID_RE.sub("", (email_id or "").strip())[:256]


def _ensure_tables(cache) -> None:
    with cache._conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS commitments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email_id TEXT NOT NULL,
                email_subject TEXT DEFAULT '',
                thread_id TEXT DEFAULT '',
                direction TEXT NOT NULL CHECK(direction IN ('i_owe','they_owe')),
                description TEXT NOT NULL,
                counterparty TEXT DEFAULT '',
                due_date TEXT,
                status TEXT DEFAULT 'open' CHECK(status IN ('open','fulfilled','expired')),
                created_at TEXT DEFAULT (datetime('now')),
                fulfilled_at TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_commitments_status "
            "ON commitments(status, created_at DESC)"
        )


# ── Models ──────────────────────────────────────────────────────────────────

class CommitmentStatusPatch(BaseModel):
    status: Literal["open", "fulfilled", "expired"]


class ScanBulkBody(BaseModel):
    days: int = 7


# ── Helpers ───────────────────────────────────────────────────────────────────

def _thread_text_and_participants(conn, email_id: str) -> tuple[str, list[str], str, str]:
    """Build a combined thread body and participant list for one email's thread."""
    row = conn.execute(
        "SELECT id, subject, sender, recipients, body, thread_id FROM emails WHERE id = ?",
        (email_id,),
    ).fetchone()
    if not row:
        return "", [], "", ""

    subject = row["subject"] or ""
    tid = row["thread_id"] or row["id"]

    msgs = conn.execute(
        """SELECT sender, recipients, body, date FROM emails
           WHERE COALESCE(thread_id, id) = ?
           ORDER BY date ASC LIMIT 20""",
        (tid,),
    ).fetchall()
    if not msgs:
        msgs = [row]

    parts: list[str] = []
    participants: set[str] = set()
    for m in msgs:
        sender = m["sender"] or ""
        if sender:
            participants.add(sender)
        try:
            recs = json.loads(m["recipients"]) if m["recipients"] else []
            for r in recs:
                if r:
                    participants.add(str(r))
        except (ValueError, TypeError):
            pass
        body = (m["body"] or "")[:1000]
        parts.append(f"From: {sender}\n{body}")

    thread_body = f"Subject: {subject}\n\n" + "\n\n---\n\n".join(parts)
    return thread_body, sorted(participants), subject, tid


async def _scan_email(cache, advisor, email_id: str) -> list[dict]:
    """Extract commitments for one email thread and persist any found. Returns new rows."""
    email_id = _safe_email_id(email_id)
    if not email_id:
        return []
    with cache._conn() as conn:
        _ensure_tables_conn(conn)
        thread_body, participants, subject, tid = _thread_text_and_participants(conn, email_id)
        if not thread_body:
            return []
        existing = conn.execute(
            "SELECT description FROM commitments WHERE email_id = ?", (email_id,)
        ).fetchall()
        seen = {(e["description"] or "").strip().lower() for e in existing}

    found = await advisor.extract_commitments(thread_body, participants)

    new_rows: list[dict] = []
    with cache._conn() as conn:
        for c in found:
            desc = c["description"].strip()
            if desc.lower() in seen:
                continue
            seen.add(desc.lower())
            cur = conn.execute(
                """INSERT INTO commitments
                   (email_id, email_subject, thread_id, direction, description, counterparty, due_date)
                   VALUES (?,?,?,?,?,?,?)""",
                (email_id, subject, tid, c["direction"], desc,
                 c["counterparty"], c["due_date"]),
            )
            new_rows.append({
                "id": cur.lastrowid,
                "email_id": email_id,
                "email_subject": subject,
                "thread_id": tid,
                "direction": c["direction"],
                "description": desc,
                "counterparty": c["counterparty"],
                "due_date": c["due_date"],
                "status": "open",
            })
    return new_rows


def _ensure_tables_conn(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS commitments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email_id TEXT NOT NULL,
            email_subject TEXT DEFAULT '',
            thread_id TEXT DEFAULT '',
            direction TEXT NOT NULL CHECK(direction IN ('i_owe','they_owe')),
            description TEXT NOT NULL,
            counterparty TEXT DEFAULT '',
            due_date TEXT,
            status TEXT DEFAULT 'open' CHECK(status IN ('open','fulfilled','expired')),
            created_at TEXT DEFAULT (datetime('now')),
            fulfilled_at TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_commitments_status "
        "ON commitments(status, created_at DESC)"
    )


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
async def list_commitments(
    request: Request,
    direction: Optional[Literal["i_owe", "they_owe"]] = None,
    status: Optional[Literal["open", "fulfilled", "expired"]] = None,
):
    cache = request.app.state.cache
    _ensure_tables(cache)
    where = []
    params: list = []
    if direction:
        where.append("direction = ?")
        params.append(direction)
    if status:
        where.append("status = ?")
        params.append(status)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    with cache._conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM commitments{clause} ORDER BY "
            "CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, created_at DESC "
            "LIMIT 200",
            params,
        ).fetchall()
    return {"commitments": [dict(r) for r in rows]}


@router.post("/scan/{email_id}")
async def scan_email(email_id: str, request: Request):
    """AI-extract commitments from a single email's thread."""
    cache = request.app.state.cache
    advisor = getattr(request.app.state, "advisor", None)
    if not advisor:
        raise HTTPException(503, "AI advisor not available")
    _ensure_tables(cache)
    found = await _scan_email(cache, advisor, email_id)
    return {"found": found}


@router.post("/scan-bulk")
async def scan_bulk(body: ScanBulkBody, request: Request):
    """Scan recent emails (last N days) for commitments."""
    cache = request.app.state.cache
    advisor = getattr(request.app.state, "advisor", None)
    if not advisor:
        raise HTTPException(503, "AI advisor not available")
    _ensure_tables(cache)

    days = max(1, min(body.days, 90))
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT COALESCE(thread_id, id) AS tid, id
               FROM emails
               WHERE date >= datetime('now', ?)
               GROUP BY tid
               ORDER BY MAX(date) DESC LIMIT 25""",
            (f"-{days} days",),
        ).fetchall()

    scanned = 0
    total_found = 0
    for r in rows:
        scanned += 1
        new_rows = await _scan_email(cache, advisor, r["id"])
        total_found += len(new_rows)
    return {"scanned": scanned, "found": total_found}


@router.patch("/{commitment_id}")
async def update_commitment(commitment_id: int, patch: CommitmentStatusPatch, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    fulfilled_at = "datetime('now')" if patch.status == "fulfilled" else "NULL"
    with cache._conn() as conn:
        cur = conn.execute(
            f"UPDATE commitments SET status = ?, fulfilled_at = {fulfilled_at} WHERE id = ?",
            (patch.status, commitment_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Commitment not found")
    return {"ok": True, "status": patch.status}


@router.delete("/{commitment_id}")
async def delete_commitment(commitment_id: int, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        conn.execute("DELETE FROM commitments WHERE id = ?", (commitment_id,))
    return {"deleted": commitment_id}


@router.post("/{commitment_id}/draft-reply")
async def draft_reply(commitment_id: int, request: Request):
    """Generate a follow-up draft for a commitment (chase the other party, or confirm you'll deliver)."""
    cache = request.app.state.cache
    advisor = getattr(request.app.state, "advisor", None)
    if not advisor:
        raise HTTPException(503, "AI advisor not available")
    _ensure_tables(cache)

    with cache._conn() as conn:
        c = conn.execute(
            "SELECT * FROM commitments WHERE id = ?", (commitment_id,)
        ).fetchone()
        if not c:
            raise HTTPException(404, "Commitment not found")
        c = dict(c)
        erow = conn.execute(
            "SELECT sender, subject FROM emails WHERE id = ?", (c["email_id"],)
        ).fetchone()

    to_addr = ""
    if erow and c["direction"] == "they_owe":
        to_addr = erow["sender"] or ""
    subject = c["email_subject"] or (erow["subject"] if erow else "") or "Follow-up"
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    due = f" (due {c['due_date']})" if c.get("due_date") else ""
    if c["direction"] == "they_owe":
        intent = (
            f"Write a polite, concise follow-up to {c['counterparty'] or 'them'} chasing this "
            f"outstanding commitment they made to me:\n\"{c['description']}\"{due}.\n"
            "Gently ask for a status update or timeline."
        )
    else:
        intent = (
            f"Write a concise, professional note to {c['counterparty'] or 'them'} about a "
            f"commitment I made:\n\"{c['description']}\"{due}.\n"
            "Either confirm I'm on track and give an updated timeline, or proactively update them."
        )

    prompt = (
        intent
        + "\n\nReturn: subject line on the first line, a blank line, then the email body. "
        "No markdown, no preamble."
    )

    try:
        ant = getattr(advisor.ai, "_anthropic", None)
        if ant:
            resp = await ant.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = next((b.text for b in resp.content if hasattr(b, "text")), "")
        else:
            resp = await advisor.ai.messages.create(
                model="claude-haiku-4-5-20251001", max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text
    except Exception as exc:
        raise HTTPException(500, str(exc))

    text = text.strip()
    lines = text.split("\n", 1)
    gen_subject = lines[0].strip()
    if gen_subject.lower().startswith("subject:"):
        gen_subject = gen_subject[len("subject:"):].strip()
    body = lines[1].strip() if len(lines) > 1 else text
    if not gen_subject:
        gen_subject = subject

    return {"to": to_addr, "subject": gen_subject, "body": body}
