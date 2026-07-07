"""Slack and Teams notification endpoints."""

import ipaddress
import logging
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from services.notification_service import post_to_slack, post_to_teams

router = APIRouter(prefix="/api/notify", tags=["notify"])

_log = logging.getLogger(__name__)


def _validate_webhook_url(url: str) -> None:
    """Reject non-HTTP schemes and local/private targets to prevent SSRF."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(400, "Webhook URL must use http or https")
    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(400, "Webhook URL has no host")
    if host == "localhost" or host.endswith(".local") or host.endswith(".internal"):
        raise HTTPException(400, "Webhook URL must not point to a local address")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        raise HTTPException(400, "Webhook URL must not point to a private address")


def _sanitize_result(result: dict, label: str) -> dict:
    """Log the real webhook error but return a generic message to the client."""
    if result.get("ok"):
        return result
    _log.error("%s webhook failed: %s", label, result.get("error"))
    return {"ok": False, "error": "Request failed"}


class NotifyEmailRequest(BaseModel):
    email_id: str


def _get_email_data(cache, email_id: str) -> dict:
    """Load email fields needed for notifications."""
    email = cache.get(email_id)
    if not email:
        return {}
    body = (email.body or "")[:200].replace("\n", " ")
    return {
        "subject": email.subject or "(no subject)",
        "sender": email.sender or "",
        "date": str(email.date or "")[:16],
        "body_preview": body,
    }


@router.post("/slack")
async def notify_slack(req: NotifyEmailRequest, request: Request):
    """Push an email summary to the configured Slack webhook."""
    from routers.config import load_app_config
    cfg = load_app_config()
    url = cfg.get("slack_webhook_url", "").strip()
    if not url:
        raise HTTPException(400, "Slack webhook URL not configured")
    _validate_webhook_url(url)

    d = _get_email_data(request.app.state.cache, req.email_id)
    if not d:
        raise HTTPException(404, "Email not found")

    result = await post_to_slack(
        webhook_url=url,
        title=f"📧 {d['subject']}",
        sender=d["sender"], subject=d["subject"],
        date=d["date"], body_preview=d["body_preview"],
        email_id=req.email_id,
    )
    return _sanitize_result(result, "Slack")


@router.post("/teams")
async def notify_teams(req: NotifyEmailRequest, request: Request):
    """Push an email summary to the configured Teams webhook."""
    from routers.config import load_app_config
    cfg = load_app_config()
    url = cfg.get("teams_webhook_url", "").strip()
    if not url:
        raise HTTPException(400, "Teams webhook URL not configured")
    _validate_webhook_url(url)

    d = _get_email_data(request.app.state.cache, req.email_id)
    if not d:
        raise HTTPException(404, "Email not found")

    result = await post_to_teams(
        webhook_url=url,
        title=f"Email: {d['subject']}",
        sender=d["sender"], subject=d["subject"],
        date=d["date"], body_preview=d["body_preview"],
    )
    return _sanitize_result(result, "Teams")


@router.post("/test-slack")
async def test_slack(request: Request):
    """Send a test message to the configured Slack webhook."""
    from routers.config import load_app_config
    cfg = load_app_config()
    url = cfg.get("slack_webhook_url", "").strip()
    if not url:
        raise HTTPException(400, "Slack webhook URL not configured")
    _validate_webhook_url(url)

    result = await post_to_slack(
        webhook_url=url,
        title="✅ Director Assistant connected to Slack",
        sender="system@director-assistant.local",
        subject="Connection test",
        date="Now",
        body_preview="If you see this, your Slack integration is working correctly.",
    )
    return _sanitize_result(result, "Slack test")


@router.post("/test-teams")
async def test_teams(request: Request):
    """Send a test message to the configured Teams webhook."""
    from routers.config import load_app_config
    cfg = load_app_config()
    url = cfg.get("teams_webhook_url", "").strip()
    if not url:
        raise HTTPException(400, "Teams webhook URL not configured")
    _validate_webhook_url(url)

    result = await post_to_teams(
        webhook_url=url,
        title="✅ Director Assistant connected to Teams",
        sender="system@director-assistant.local",
        subject="Connection test",
        date="Now",
        body_preview="If you see this, your Teams integration is working correctly.",
    )
    return _sanitize_result(result, "Teams test")
