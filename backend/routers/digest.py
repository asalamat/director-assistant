from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/digest", tags=["digest"])


@router.get("")
async def get_digest(request: Request, hours: int = 24):
    cache = request.app.state.cache
    digest_svc = request.app.state.digest
    return await digest_svc.generate(cache, hours=hours)
