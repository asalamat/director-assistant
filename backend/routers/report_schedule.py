"""Scheduled report — on-demand trigger and status."""

import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/report", tags=["report"])


@router.post("/send-now")
async def send_report_now(request: Request):
    """Immediately queue the weekly brief email."""
    from routers.config import load_app_config
    cfg = load_app_config()
    to_email = cfg.get("report_email_to", "").strip()
    if not to_email:
        raise HTTPException(400, "report_email_to not configured — set destination email in Settings → Integrations")
    from workers.reports_worker import _generate_and_send_report
    asyncio.create_task(_generate_and_send_report(request.app))
    return {"queued": True, "sent_to": to_email}


@router.post("/board")
async def generate_board_report(request: Request):
    """Generate a monthly executive status report from email activity."""
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    since = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT subject, sender, date, folder FROM emails
               WHERE date >= ? ORDER BY date DESC LIMIT 200""",
            (since,),
        ).fetchall()

    sent = [r for r in rows if "sent" in (r["folder"] or "").lower()]
    received = [r for r in rows if "sent" not in (r["folder"] or "").lower()]

    snippets = "\n".join(
        f"[{r['date'][:10] if r['date'] else '?'}] {r['sender']}: {r['subject']}"
        for r in (received[:40] + sent[:20])
    )

    prompt = f"""Generate a professional monthly executive status report for a board audience.

Based on email activity from the past 30 days:
{snippets}

Create a concise report with:
1. Executive Summary (2-3 sentences)
2. Key Accomplishments this month
3. Active Initiatives & Status
4. Decisions Made
5. Outstanding Issues / Risks
6. Next Month Priorities

Write in professional business language suitable for a board briefing."""

    ant = getattr(advisor.ai, "_anthropic", None)
    try:
        if ant:
            resp = await ant.messages.create(
                model="claude-sonnet-4-6", max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            report = resp.content[0].text.strip()
        else:
            resp = await advisor.ai.messages.create(
                model="claude-sonnet-4-6", max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            report = resp.content[0].text.strip()
    except Exception as exc:
        raise HTTPException(500, str(exc))

    return {"report": report, "period": f"Last 30 days ending {datetime.utcnow().strftime('%B %d, %Y')}",
            "emails_analyzed": len(rows)}


@router.get("/status")
async def report_status(request: Request):
    """Return current report schedule configuration."""
    from routers.config import load_app_config
    cfg = load_app_config()
    return {
        "enabled": cfg.get("report_email_enabled", False),
        "schedule": cfg.get("report_email_schedule", "monday:07:00"),
        "email_to": cfg.get("report_email_to", ""),
    }
