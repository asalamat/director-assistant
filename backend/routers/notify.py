"""Slack and Teams notification endpoints."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from services.notification_service import post_to_slack, post_to_teams

router = APIRouter(prefix="/api/notify", tags=["notify"])


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
        "date": (email.date or "")[:16],
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
    return result


@router.post("/teams")
async def notify_teams(req: NotifyEmailRequest, request: Request):
    """Push an email summary to the configured Teams webhook."""
    from routers.config import load_app_config
    cfg = load_app_config()
    url = cfg.get("teams_webhook_url", "").strip()
    if not url:
        raise HTTPException(400, "Teams webhook URL not configured")

    d = _get_email_data(request.app.state.cache, req.email_id)
    if not d:
        raise HTTPException(404, "Email not found")

    result = await post_to_teams(
        webhook_url=url,
        title=f"Email: {d['subject']}",
        sender=d["sender"], subject=d["subject"],
        date=d["date"], body_preview=d["body_preview"],
    )
    return result


@router.post("/test-slack")
async def test_slack(request: Request):
    """Send a test message to the configured Slack webhook."""
    from routers.config import load_app_config
    cfg = load_app_config()
    url = cfg.get("slack_webhook_url", "").strip()
    if not url:
        raise HTTPException(400, "Slack webhook URL not configured")

    result = await post_to_slack(
        webhook_url=url,
        title="✅ Director Assistant connected to Slack",
        sender="system@director-assistant.local",
        subject="Connection test",
        date="Now",
        body_preview="If you see this, your Slack integration is working correctly.",
    )
    return result


@router.post("/test-teams")
async def test_teams(request: Request):
    """Send a test message to the configured Teams webhook."""
    from routers.config import load_app_config
    cfg = load_app_config()
    url = cfg.get("teams_webhook_url", "").strip()
    if not url:
        raise HTTPException(400, "Teams webhook URL not configured")

    result = await post_to_teams(
        webhook_url=url,
        title="✅ Director Assistant connected to Teams",
        sender="system@director-assistant.local",
        subject="Connection test",
        date="Now",
        body_preview="If you see this, your Teams integration is working correctly.",
    )
    return result
