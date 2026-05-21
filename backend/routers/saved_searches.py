from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/saved-searches", tags=["saved-searches"])


class SavedSearchCreate(BaseModel):
    name: str
    query: str
    folder: str = "INBOX"


@router.get("")
async def list_saved_searches(request: Request):
    return request.app.state.cache.list_saved_searches()


@router.post("")
async def create_saved_search(body: SavedSearchCreate, request: Request):
    sid = request.app.state.cache.add_saved_search(body.name, body.query, body.folder)
    return {"id": sid}


@router.delete("/{sid}")
async def delete_saved_search(sid: int, request: Request):
    if not request.app.state.cache.delete_saved_search(sid):
        raise HTTPException(404, "Not found")
    return {"ok": True}
