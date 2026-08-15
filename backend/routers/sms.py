"""SMS channel via Twilio's REST API — settings, inbound fetch, outbound send, AI draft.

No webhook is used: inbound messages are pulled on the existing background poll
cycle (see workers/poll.py) since this app has no public endpoint to receive
Twilio's webhook callbacks.
"""

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/sms", tags=["sms"])


def _get_sms_settings() -> dict:
    from routers.config import load_app_config
    cfg = load_app_config()
    sms = cfg.get("sms", {}) or {}
    return {
        "account_sid": sms.get("account_sid", ""),
        "auth_token": sms.get("auth_token", ""),
        "from_number": sms.get("from_number", ""),
    }


@router.get("/settings")
async def get_settings():
    s = _get_sms_settings()
    return {
        "account_sid": s["account_sid"],
        "from_number": s["from_number"],
        "auth_token_set": bool(s["auth_token"]),
    }


@router.post("/settings")
async def save_settings(body: dict):
    from routers.config import load_app_config, save_app_config
    cfg = load_app_config()
    sms = cfg.get("sms", {}) or {}
    for key in ("account_sid", "auth_token", "from_number"):
        if key in body and body[key] is not None:
            sms[key] = body[key]
    cfg["sms"] = sms
    save_app_config(cfg)
    return {"status": "saved"}


async def _send_sms(to: str, body: str) -> dict:
    """Send an SMS via Twilio. Returns {sid} on success or {error} on failure."""
    settings = _get_sms_settings()
    sid, token, from_number = settings["account_sid"], settings["auth_token"], settings["from_number"]
    if not sid or not token or not from_number:
        return {"error": "SMS not configured — go to Settings → SMS"}
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    async with httpx.AsyncClient(timeout=15.0, auth=(sid, token)) as http:
        r = await http.post(url, data={"To": to, "From": from_number, "Body": body})
    if r.status_code >= 300:
        return {"error": f"Twilio send failed {r.status_code}: {r.text[:200]}"}
    return {"sid": (r.json() or {}).get("sid", "")}


async def _fetch_sms() -> list[dict]:
    """Fetch recent inbound SMS messages, shaped as social_inbox rows."""
    settings = _get_sms_settings()
    sid, token, from_number = settings["account_sid"], settings["auth_token"], settings["from_number"]
    if not sid or not token or not from_number:
        raise ValueError("SMS not configured — go to Settings → SMS")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    async with httpx.AsyncClient(timeout=15.0, auth=(sid, token)) as http:
        r = await http.get(url, params={"To": from_number, "PageSize": 50})
    if r.status_code >= 300:
        raise ValueError(f"Twilio fetch failed {r.status_code}: {r.text[:200]}")
    rows: list[dict] = []
    for m in (r.json() or {}).get("messages", []):
        if m.get("direction") != "inbound":
            continue
        msid = m.get("sid")
        if not msid:
            continue
        rows.append({
            "id": f"sms_{msid}",
            "platform": "sms",
            "type": "dm",
            "sender_name": m.get("from") or "",
            "sender_id": m.get("from") or "",
            "content": m.get("body") or "",
            "created_at": m.get("date_sent") or datetime.now(timezone.utc).isoformat(),
        })
    return rows


@router.post("/test")
async def test_connection():
    """Send a test SMS to the configured From number to confirm credentials work."""
    settings = _get_sms_settings()
    if not settings["from_number"]:
        return {"ok": False, "error": "Set a From Number first"}
    result = await _send_sms(settings["from_number"], "Cortex Executive Inbox: SMS test message")
    if "error" in result:
        return {"ok": False, "error": result["error"]}
    return {"ok": True}


@router.post("/draft-reply")
async def draft_reply(body: dict, request: Request):
    """Generate a short AI reply draft for an inbound SMS thread."""
    incoming_text = (body.get("text") or "").strip()
    if not incoming_text:
        return {"draft": "", "error": "text is required"}
    advisor = request.app.state.advisor
    prompt = (
        "Write a short SMS reply (under 160 characters, no greeting or signature) "
        f"to this text message:\n\n{incoming_text}"
    )
    try:
        resp = await advisor.ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=100,
            messages=[{"role": "user", "content": prompt}],
        )
        draft = resp.content[0].text.strip()
    except Exception as e:
        return {"draft": "", "error": f"Draft generation failed: {e}"}
    return {"draft": draft}
