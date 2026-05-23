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


class ComposeRequest(BaseModel):
    to: str
    cc: str = ""
    bcc: str = ""
    subject: str
    body: str
    account_id: int = 0


def _resolve_account(cache, account_id: int):
    if account_id:
        acc = cache.get_account(account_id)
        if not acc:
            raise HTTPException(404, "Account not found")
        return acc
    accounts = cache.list_accounts()
    if not accounts:
        raise HTTPException(400, "No accounts configured")
    return accounts[0]


def _smtp_send(acc, msg: MIMEMultipart):
    provider_key = acc.provider.value if hasattr(acc.provider, "value") else str(acc.provider)
    smtp = _SMTP.get(provider_key, {"host": "smtp.gmail.com", "port": 587, "ssl": False})
    recipients = [r.strip() for r in
                  (msg.get("To", "") + "," + msg.get("Cc", "") + "," + msg.get("Bcc", "")).split(",")
                  if r.strip()]
    try:
        ctx = ssl.create_default_context()
        if smtp["ssl"]:
            with smtplib.SMTP_SSL(smtp["host"], smtp["port"], context=ctx) as srv:
                srv.login(acc.username, acc.password)
                srv.sendmail(acc.username, recipients, msg.as_string())
        else:
            with smtplib.SMTP(smtp["host"], smtp["port"]) as srv:
                srv.ehlo()
                srv.starttls(context=ctx)
                srv.login(acc.username, acc.password)
                srv.sendmail(acc.username, recipients, msg.as_string())
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(401, "SMTP authentication failed — check your app password")
    except Exception as e:
        raise HTTPException(500, f"Send failed: {e}")


@router.post("/send")
async def send_email(req: SendRequest, request: Request):
    cache = request.app.state.cache
    acc = _resolve_account(cache, req.account_id)

    msg = MIMEMultipart()
    msg["From"] = acc.username
    msg["To"] = req.to
    msg["Subject"] = req.subject
    msg.attach(MIMEText(req.body, "plain", "utf-8"))
    _smtp_send(acc, msg)
    return {"status": "sent"}


@router.post("/send-new")
async def send_new_email(req: ComposeRequest, request: Request):
    """Compose and send a brand-new email (not a reply)."""
    if not req.to.strip():
        raise HTTPException(400, "Recipient 'to' is required")
    if not req.subject.strip():
        raise HTTPException(400, "Subject is required")

    cache = request.app.state.cache
    acc = _resolve_account(cache, req.account_id)

    msg = MIMEMultipart()
    msg["From"] = acc.username
    msg["To"] = req.to.strip()
    if req.cc.strip():
        msg["Cc"] = req.cc.strip()
    if req.bcc.strip():
        msg["Bcc"] = req.bcc.strip()
    msg["Subject"] = req.subject.strip()
    msg.attach(MIMEText(req.body, "plain", "utf-8"))
    _smtp_send(acc, msg)
    return {"status": "sent", "to": req.to, "subject": req.subject}
