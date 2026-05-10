from fastapi import APIRouter, Request, HTTPException

from models import Template

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("")
async def list_templates(request: Request):
    return request.app.state.cache.list_templates()


@router.post("")
async def create_template(t: Template, request: Request):
    tid = request.app.state.cache.save_template(t)
    return {"id": tid}


@router.put("/{tid}")
async def update_template(tid: int, t: Template, request: Request):
    t.id = tid
    request.app.state.cache.save_template(t)
    return {"ok": True}


@router.delete("/{tid}")
async def delete_template(tid: int, request: Request):
    if not request.app.state.cache.delete_template(tid):
        raise HTTPException(404, "Template not found")
    return {"ok": True}
