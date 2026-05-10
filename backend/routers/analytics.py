from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("")
async def get_analytics(request: Request, days: int = 30):
    cache = request.app.state.cache
    return {
        "daily_volume": cache.daily_volume(days=days),
        "top_senders": cache.top_senders(limit=10),
        "folder_breakdown": cache.folder_breakdown(),
        "total_emails": cache.count(),
    }
