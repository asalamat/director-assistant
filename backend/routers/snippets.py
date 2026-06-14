"""Canned responses / text snippets for quick insertion in compose."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/snippets", tags=["snippets"])


class SnippetCreate(BaseModel):
    name: str
    content: str
    shortcut: str = ""


@router.get("")
async def list_snippets(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute("SELECT * FROM snippets ORDER BY name").fetchall()
    return {"snippets": [dict(r) for r in rows]}


@router.post("")
async def create_snippet(req: SnippetCreate, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        cur = conn.execute(
            "INSERT INTO snippets (name, content, shortcut) VALUES (?,?,?)",
            (req.name, req.content, req.shortcut),
        )
    return {"id": cur.lastrowid, "status": "created"}


@router.delete("/{snippet_id}")
async def delete_snippet(snippet_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM snippets WHERE id=?", (snippet_id,))
    return {"deleted": snippet_id}
