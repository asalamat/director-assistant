"""Email action endpoints — one-click unsubscribe."""
from email.mime.text import MIMEText

from fastapi import APIRouter, HTTPException, Request

from routers.email_send import _resolve_account, _smtp_send
from services.unsubscribe import detect_unsubscribe

router = APIRouter(prefix="/api/emails", tags=["email-actions"])


@router.post("/{email_id}/unsubscribe")
async def unsubscribe(email_id: str, request: Request):
    """Resolve and (for mailto targets) perform a one-click unsubscribe.

    - method "url": returns the URL for the frontend to open in a new tab.
    - method "mailto": sends an unsubscribe email via the account's SMTP and
      returns {sent: true}.
    - method "none": nothing actionable was found.
    """
    cache = request.app.state.cache
    email = cache.get(email_id)
    if not email:
        raise HTTPException(404, "Email not found")

    result = detect_unsubscribe(email)
    method = result.get("method")

    if method == "url":
        return {"method": "url", "url": result["url"]}

    if method == "mailto":
        acc = _resolve_account(cache, 0)
        msg = MIMEText("Please unsubscribe me from this mailing list.", "plain", "utf-8")
        msg["From"] = acc.username
        msg["To"] = result["address"]
        msg["Subject"] = result.get("subject") or "unsubscribe"
        _smtp_send(acc, msg)
        return {"method": "mailto", "sent": True}

    return {"method": "none"}
