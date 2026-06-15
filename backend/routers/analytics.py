import csv
import io
from collections import Counter
from datetime import date, timedelta
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# Urgency score mapping by category
_CATEGORY_SCORE: dict[str, float] = {
    "action_required": 3.0,
    "meeting": 3.0,
    "proposal": 2.0,
    "contract": 2.0,
    "invoice": 2.0,
    "fyi": 1.0,
    "newsletter": 1.0,
}
_DEFAULT_SCORE = 1.5  # "other" / unknown


@router.get("")
async def get_analytics(request: Request, days: int = 30):
    cache = request.app.state.cache
    return {
        "daily_volume": cache.daily_volume(days=days),
        "top_senders": cache.top_senders(limit=10),
        "folder_breakdown": cache.folder_breakdown(),
        "total_emails": cache.count(),
    }


@router.get("/mood-timeline")
async def mood_timeline(request: Request, days: int = 30):
    """
    Return average urgency/mood score per day over the last `days` days.
    Score scale: 1 (low urgency) → 3 (high urgency).
    Response: [{date, score, count, dominant_category}]
    """
    cache = request.app.state.cache
    cutoff = (date.today() - timedelta(days=days)).isoformat()

    with cache._conn() as conn:
        rows = conn.execute(
            """
            SELECT
                substr(e.date, 1, 10) AS day,
                ec.category,
                COUNT(*)              AS cnt
            FROM emails e
            LEFT JOIN email_categories ec ON ec.email_id = e.id
            WHERE e.date >= ?
              AND substr(e.date, 1, 10) != ''
            GROUP BY day, ec.category
            ORDER BY day
            """,
            (cutoff,),
        ).fetchall()

    # Aggregate per day
    day_data: dict[str, dict] = {}
    for row in rows:
        day = row["day"]
        if not day:
            continue
        cat = row["category"] or "other"
        cnt = row["cnt"]
        score = _CATEGORY_SCORE.get(cat, _DEFAULT_SCORE)

        if day not in day_data:
            day_data[day] = {"total_score": 0.0, "total_count": 0, "cat_counts": {}}
        day_data[day]["total_score"] += score * cnt
        day_data[day]["total_count"] += cnt
        day_data[day]["cat_counts"][cat] = day_data[day]["cat_counts"].get(cat, 0) + cnt

    result = []
    for day in sorted(day_data):
        d = day_data[day]
        total_count = d["total_count"]
        avg_score = round(d["total_score"] / total_count, 2) if total_count else _DEFAULT_SCORE
        dominant = max(d["cat_counts"], key=lambda c: d["cat_counts"][c]) if d["cat_counts"] else "other"
        result.append({
            "date": day,
            "score": avg_score,
            "count": total_count,
            "dominant_category": dominant,
        })

    return result


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


@router.get("/send-time/{email_addr}")
async def best_send_time(email_addr: str, request: Request):
    """Analyse when this recipient typically replies to estimate the best send time."""
    cache = request.app.state.cache
    addr = email_addr.lower().strip()

    with cache._conn() as conn:
        # Find emails from this sender — the hour/day they send gives insight into
        # when they're active (and thus likely to reply quickly)
        rows = conn.execute(
            """SELECT date FROM emails WHERE LOWER(sender) LIKE ?
               AND date IS NOT NULL ORDER BY date DESC LIMIT 200""",
            (f"%{addr}%",)
        ).fetchall()

    if not rows:
        return {"email_addr": email_addr, "suggestion": None,
                "reason": "No email history with this contact"}

    hour_counts: Counter = Counter()
    day_counts: Counter = Counter()
    DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    for row in rows:
        try:
            from datetime import datetime as dt
            d = dt.fromisoformat(str(row["date"]).replace("Z", "+00:00").split("+")[0])
            hour_counts[d.hour] += 1
            day_counts[d.weekday()] += 1
        except Exception:
            pass

    if not hour_counts:
        return {"email_addr": email_addr, "suggestion": None,
                "reason": "Could not parse dates"}

    best_hour = hour_counts.most_common(1)[0][0]
    best_day_idx = day_counts.most_common(1)[0][0]
    best_day = DAYS[best_day_idx]

    # Format hour as readable time
    am_pm = "AM" if best_hour < 12 else "PM"
    display_hour = best_hour if best_hour <= 12 else best_hour - 12
    if display_hour == 0:
        display_hour = 12
    time_str = f"{display_hour}:00 {am_pm}"

    # Top 3 active hours
    top_hours = [
        f"{h if h <= 12 else h-12 or 12}{'AM' if h < 12 else 'PM'}"
        for h, _ in hour_counts.most_common(3)
    ]
    top_days = [DAYS[d] for d, _ in day_counts.most_common(3) if d < 5]  # weekdays only

    return {
        "email_addr": email_addr,
        "suggestion": f"{best_day} at {time_str}",
        "best_day": best_day,
        "best_hour": best_hour,
        "best_hour_display": time_str,
        "top_hours": top_hours,
        "top_days": top_days,
        "sample_size": len(rows),
        "reason": f"Based on {len(rows)} emails — {best_day} at {time_str} is when they're most active",
    }
