"""Delegation tracking — forwarded emails awaiting action."""

import json
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/delegations", tags=["delegations"])


class DelegationCreate(BaseModel):
    email_id: str
    subject: str = ""
    original_sender: str = ""
    delegated_to: str
    note: str = ""


@router.get("")
async def list_delegations(request: Request, status: Optional[str] = None):
    """List delegations, optionally filtered by status (pending/resolved)."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM email_delegations WHERE status = ? ORDER BY delegated_at DESC",
                (status,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM email_delegations ORDER BY delegated_at DESC LIMIT 50"
            ).fetchall()
    return {"delegations": [dict(r) for r in rows]}


@router.post("")
async def create_delegation(req: DelegationCreate, request: Request):
    """Record a new delegation."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        cur = conn.execute(
            """INSERT INTO email_delegations (email_id, subject, original_sender, delegated_to, note)
               VALUES (?,?,?,?,?)""",
            (req.email_id, req.subject, req.original_sender, req.delegated_to, req.note),
        )
    return {"id": cur.lastrowid, "status": "created"}


@router.patch("/{delegation_id}/resolve")
async def resolve_delegation(delegation_id: int, request: Request):
    """Mark a delegation as resolved."""
    cache = request.app.state.cache
    with cache._conn() as conn:
        cur = conn.execute(
            "UPDATE email_delegations SET status='resolved', resolved_at=datetime('now') WHERE id=?",
            (delegation_id,),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Delegation not found")
    return {"status": "resolved"}


@router.delete("/{delegation_id}")
async def delete_delegation(delegation_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM email_delegations WHERE id=?", (delegation_id,))
    return {"deleted": delegation_id}


@router.post("/auto-check")
async def auto_check_delegations(request: Request):
    """Cross-reference pending delegations against received emails to auto-resolve."""
    cache = request.app.state.cache
    resolved = 0
    with cache._conn() as conn:
        pending = conn.execute(
            "SELECT id, email_id, delegated_to, original_sender FROM email_delegations WHERE status='pending'"
        ).fetchall()
        for d in pending:
            # Check if there's a reply from anyone (to the original thread) since delegation was created
            replied = conn.execute(
                """SELECT COUNT(*) as cnt FROM emails
                   WHERE (LOWER(sender) LIKE ? OR LOWER(sender) LIKE ?)
                   AND date >= (SELECT delegated_at FROM email_delegations WHERE id=?)""",
                (f"%{d['delegated_to'].lower()}%", f"%{d['original_sender'].lower()}%", d["id"]),
            ).fetchone()
            if replied and replied["cnt"] > 0:
                conn.execute(
                    "UPDATE email_delegations SET status='resolved', resolved_at=datetime('now') WHERE id=?",
                    (d["id"],),
                )
                resolved += 1
    return {"resolved": resolved}
