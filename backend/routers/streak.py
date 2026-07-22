"""Inbox Zero Streak tracker."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/streak", tags=["streak"])


def _compute_streak(conn) -> dict:
    rows = conn.execute(
        "SELECT date, is_zero FROM inbox_streak ORDER BY date DESC"
    ).fetchall()

    last_zero = None
    longest = 0
    current = 0
    run = 0

    for i, r in enumerate(rows):
        if r["is_zero"]:
            if last_zero is None:
                last_zero = r["date"]
            if i == 0 or rows[i - 1]["is_zero"]:
                current += 1
            run += 1
            longest = max(longest, run)
        else:
            run = 0
            if i == 0:
                current = 0

    # current streak: consecutive is_zero=1 from the most recent row
    current_streak = 0
    for r in rows:
        if r["is_zero"]:
            current_streak += 1
        else:
            break

    # longest streak: scan all rows in chronological order
    asc_rows = list(reversed(rows))
    longest_streak = 0
    streak_run = 0
    for r in asc_rows:
        if r["is_zero"]:
            streak_run += 1
            longest_streak = max(longest_streak, streak_run)
        else:
            streak_run = 0

    return {"current": current_streak, "longest": longest_streak, "last_zero": last_zero}


@router.get("")
async def get_streak(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        return _compute_streak(conn)


class CheckRequest(BaseModel):
    inbox_count: int


@router.post("/check")
async def check_streak(req: CheckRequest, request: Request):
    cache = request.app.state.cache
    is_zero = 1 if req.inbox_count == 0 else 0
    with cache._conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO inbox_streak(date, is_zero) VALUES(date('now'), ?)",
            (is_zero,),
        )
        return _compute_streak(conn)
