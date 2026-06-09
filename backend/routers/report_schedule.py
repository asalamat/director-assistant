"""Scheduled report — on-demand trigger and status."""

import asyncio
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
    from workers.background_tasks import _generate_and_send_report
    asyncio.create_task(_generate_and_send_report(request.app))
    return {"queued": True, "sent_to": to_email}


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
