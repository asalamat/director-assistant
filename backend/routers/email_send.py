"""Send email via SMTP for the active account."""
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/email", tags=["email"])

_SMTP: dict[str, dict] = {
    "gmail":      {"host": "smtp.gmail.com",        "port": 587, "ssl": False},
    "yahoo_imap": {"host": "smtp.mail.yahoo.com",   "port": 465, "ssl": True},
    "hotmail":    {"host": "smtp-mail.outlook.com", "port": 587, "ssl": False},
}


class SendRequest(BaseModel):
    to: str
    subject: str
    body: str
    account_id: int = 0


@router.post("/send")
async def send_email(req: SendRequest, request: Request):
    cache = request.app.state.cache

    acc = None
    if req.account_id:
        acc = cache.get_account(req.account_id)
        if not acc:
            raise HTTPException(404, "Account not found")
    else:
        accounts = cache.list_accounts()
        if not accounts:
            raise HTTPException(400, "No accounts configured")
        acc = accounts[0]

    provider_key = acc.provider.value if hasattr(acc.provider, "value") else str(acc.provider)
    smtp = _SMTP.get(provider_key, {"host": "smtp.gmail.com", "port": 587, "ssl": False})

    msg = MIMEMultipart()
    msg["From"] = acc.username
    msg["To"] = req.to
    msg["Subject"] = req.subject
    msg.attach(MIMEText(req.body, "plain", "utf-8"))

    try:
        ctx = ssl.create_default_context()
        if smtp["ssl"]:
            with smtplib.SMTP_SSL(smtp["host"], smtp["port"], context=ctx) as srv:
                srv.login(acc.username, acc.password)
                srv.sendmail(acc.username, req.to, msg.as_string())
        else:
            with smtplib.SMTP(smtp["host"], smtp["port"]) as srv:
                srv.ehlo()
                srv.starttls(context=ctx)
                srv.login(acc.username, acc.password)
                srv.sendmail(acc.username, req.to, msg.as_string())
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(401, "SMTP authentication failed — check your app password")
    except Exception as e:
        raise HTTPException(500, f"Send failed: {e}")

    return {"status": "sent"}
