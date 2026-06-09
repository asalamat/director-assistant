"""Webhook management — test and status endpoints."""

import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


class WebhookTestRequest(BaseModel):
    url: str


@router.get("")
async def get_webhook_config(request: Request):
    """Return current webhook configuration."""
    from routers.config import load_app_config
    cfg = load_app_config()
    return {
        "urls": cfg.get("webhook_urls") or [],
        "events": cfg.get("webhook_events") or [],
    }


@router.post("/test")
async def test_webhook(req: WebhookTestRequest):
    """Send a sample payload to a webhook URL and return the HTTP result."""
    envelope = {
        "event": "new_email",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "email_id": "test-001",
            "subject": "Director Assistant webhook test",
            "sender": "system@director-assistant.local",
            "date": datetime.now(timezone.utc).isoformat(),
            "folder": "INBOX",
        },
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(req.url, json=envelope)
        return {"ok": r.status_code < 400, "status_code": r.status_code, "error": None}
    except Exception as e:
        return {"ok": False, "status_code": None, "error": str(e)}
