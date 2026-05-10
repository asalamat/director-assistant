from fastapi import APIRouter, Request
from urllib.parse import unquote

router = APIRouter(prefix="/api/sender", tags=["sender"])


@router.get("/{sender:path}")
async def get_sender_stats(sender: str, request: Request):
    decoded = unquote(sender)
    return request.app.state.cache.sender_stats(decoded)
