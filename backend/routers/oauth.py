"""
Microsoft OAuth2 device-flow endpoints.
Lets the user sign in via browser (no redirect URI needed — works for local apps).
"""

from fastapi import APIRouter, HTTPException, Request
import httpx

router = APIRouter(prefix="/api/oauth", tags=["oauth"])

_flows: dict[str, dict] = {}

_MS_AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0"
_SCOPES = "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"


@router.post("/microsoft/start")
async def start_microsoft_oauth(body: dict):
    """Start a Microsoft device-code flow. Returns user_code + verification_uri."""
    client_id = (body.get("client_id") or "").strip()
    username = (body.get("username") or "").strip()
    if not client_id:
        raise HTTPException(400, "client_id is required")

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{_MS_AUTHORITY}/devicecode",
            data={"client_id": client_id, "scope": _SCOPES},
        )
    data = r.json()
    if "error" in data:
        raise HTTPException(400, data.get("error_description") or data["error"])

    flow_id = data["device_code"][:24]
    _flows[flow_id] = {
        "client_id": client_id,
        "device_code": data["device_code"],
        "username": username,
    }

    return {
        "flow_id": flow_id,
        "user_code": data["user_code"],
        "verification_uri": data["verification_uri"],
        "expires_in": data.get("expires_in", 900),
    }


@router.get("/microsoft/poll")
async def poll_microsoft_oauth(flow_id: str, request: Request):
    """Poll for token once. Returns status: pending | completed."""
    if flow_id not in _flows:
        raise HTTPException(404, "Flow not found or expired")

    entry = _flows[flow_id]
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{_MS_AUTHORITY}/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": entry["client_id"],
                "device_code": entry["device_code"],
            },
        )
    data = r.json()

    if "access_token" in data:
        access_token = data["access_token"]
        username = entry["username"]
        del _flows[flow_id]

        # If a matching account already exists in the cache, update its token.
        cache = request.app.state.cache
        accounts = cache.list_accounts()
        for acc in accounts:
            if acc.username.lower() == username.lower():
                cache.store_account_token(acc.id, access_token)
                break

        return {"status": "completed", "access_token": access_token, "username": username}

    error = data.get("error", "")
    if error == "authorization_pending":
        return {"status": "pending"}
    if error == "expired_token":
        del _flows[flow_id]
        raise HTTPException(400, "Sign-in window expired — please start again")

    del _flows[flow_id]
    raise HTTPException(400, data.get("error_description") or error)
