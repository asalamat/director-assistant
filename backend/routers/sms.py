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
