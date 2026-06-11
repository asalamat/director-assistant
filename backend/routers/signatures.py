"""Email signature management."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/signatures", tags=["signatures"])


class SignatureCreate(BaseModel):
    name: str
    content: str
    is_default: bool = False
    account_id: int = 0


@router.get("")
async def list_signatures(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT * FROM email_signatures ORDER BY is_default DESC, name"
        ).fetchall()
    return {"signatures": [dict(r) for r in rows]}


@router.post("")
async def create_signature(req: SignatureCreate, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        if req.is_default:
            conn.execute(
                "UPDATE email_signatures SET is_default=0 WHERE account_id=?",
                (req.account_id,),
            )
        cur = conn.execute(
            "INSERT INTO email_signatures (name, content, is_default, account_id)"
            " VALUES (?,?,?,?)",
            (req.name, req.content, 1 if req.is_default else 0, req.account_id),
        )
    return {"id": cur.lastrowid, "status": "created"}


@router.patch("/{sig_id}")
async def update_signature(sig_id: int, req: SignatureCreate, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        if req.is_default:
            conn.execute(
                "UPDATE email_signatures SET is_default=0 WHERE account_id=?",
                (req.account_id,),
            )
        cur = conn.execute(
            "UPDATE email_signatures SET name=?, content=?, is_default=?, account_id=?"
            " WHERE id=?",
            (req.name, req.content, 1 if req.is_default else 0, req.account_id, sig_id),
        )
    if cur.rowcount == 0:
        raise HTTPException(404, "Signature not found")
    return {"status": "updated"}


@router.delete("/{sig_id}")
async def delete_signature(sig_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM email_signatures WHERE id=?", (sig_id,))
    return {"deleted": sig_id}
