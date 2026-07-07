"""Webhook management — test and status endpoints."""

import httpx
from datetime import datetime, timezone
from urllib.parse import urlparse
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


class WebhookTestRequest(BaseModel):
    url: str


def _validate_webhook_url(url: str):
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise HTTPException(400, "Webhook URL must use http or https")
    host = (p.hostname or "").lower()
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1") or host.endswith(".local"):
        raise HTTPException(400, "Webhook URL cannot target localhost")


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
    _validate_webhook_url(req.url)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(req.url, json=envelope)
        return {"ok": r.status_code < 400, "status_code": r.status_code, "error": None}
    except Exception:
        return {"ok": False, "status_code": None, "error": "Request failed"}
