import csv
import io
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

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


@router.get("/export.csv")
async def export_analytics_csv(request: Request, days: int = 30):
    cache = request.app.state.cache
    buf = io.StringIO()
    w = csv.writer(buf)

    w.writerow(["section", "key", "value"])
    for row in cache.daily_volume(days=days):
        w.writerow(["daily_volume", row["date"], row["count"]])
    for row in cache.top_senders(limit=20):
        w.writerow(["top_senders", row["sender"], row["count"]])
    for folder, cnt in cache.folder_breakdown().items():
        w.writerow(["folder_breakdown", folder, cnt])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=analytics_{days}d.csv"},
    )
