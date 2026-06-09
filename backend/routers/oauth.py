"""
OAuth2 endpoints.
- Microsoft: /microsoft/auth-url + /microsoft/callback (popup), /microsoft/start + /microsoft/poll (device code)
- Google:    /google/auth-url + /google/callback (popup)
"""

from __future__ import annotations

import html as _html
import json
import secrets
import urllib.parse

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import HTMLResponse
import httpx

router = APIRouter(prefix="/api/oauth", tags=["oauth"])

_flows: dict[str, dict] = {}          # device-code flows
_pending_states: dict[str, dict] = {} # redirect-flow state → {username, client_id}
_google_states: dict[str, dict] = {}  # Google redirect-flow state → {username}

_MS_AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0"
_SCOPES = (
    "offline_access "
    "https://graph.microsoft.com/User.Read "
    "https://graph.microsoft.com/Mail.Read "
    "https://graph.microsoft.com/Mail.ReadWrite "
    "https://graph.microsoft.com/Files.Read "
    "https://graph.microsoft.com/Calendars.ReadWrite "
    "https://graph.microsoft.com/Contacts.Read"
)


def _get_stored_client_id() -> str:
    """Read ms_client_id from app config (set once in App Settings)."""
    from routers.config import load_app_config
    return (load_app_config().get("ms_client_id") or "").strip()


def _redirect_uri(request: Request) -> str:
    # Always use localhost so it works behind any proxy/port
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/oauth/microsoft/callback"


def _callback_page(success: bool, username: str = "", message: str = "") -> str:
    """Self-closing HTML page that posts a message to the opener."""
    safe_username = _html.escape(username)
    safe_message = _html.escape(message)
    if success:
        data = json.dumps({"type": "oauth-complete", "username": username})
        body = f"""
<div style="text-align:center;padding:60px;font-family:system-ui,sans-serif">
  <div style="font-size:48px">✓</div>
  <h2 style="color:#16a34a;margin:16px 0 8px">Signed in successfully</h2>
  <p style="color:#6b7280">{safe_username}</p>
  <p style="color:#9ca3af;font-size:13px;margin-top:24px">This window will close automatically…</p>
</div>"""
    else:
        data = json.dumps({"type": "oauth-error", "message": message})
        body = f"""
<div style="text-align:center;padding:60px;font-family:system-ui,sans-serif">
  <div style="font-size:48px">✗</div>
  <h2 style="color:#dc2626;margin:16px 0 8px">Sign-in failed</h2>
  <p style="color:#6b7280">{safe_message}</p>
  <button onclick="window.close()" style="margin-top:24px;padding:8px 20px;border-radius:8px;
    border:1px solid #d1d5db;background:#f9fafb;cursor:pointer;font-size:14px">Close</button>
</div>"""

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Director Assistant — Microsoft Sign-in</title></head>
<body style="margin:0;background:#f9fafb">{body}
<script>
var data = {data};
try {{ window.opener && window.opener.postMessage(data, window.location.origin); }} catch(e) {{}}
if (data.type === 'oauth-complete') {{ setTimeout(function(){{ window.close(); }}, 1200); }}
</script></body></html>"""


# ── Redirect flow (used by UI) ────────────────────────────────────────────────

@router.get("/microsoft/auth-url")
async def get_microsoft_auth_url(request: Request, username: str = ""):
    """Generate a Microsoft OAuth2 authorization URL for the popup redirect flow."""
    client_id = _get_stored_client_id()
    if not client_id:
        raise HTTPException(
            400,
            "Microsoft App Client ID not configured. "
            "Go to App Settings → Microsoft App Client ID and enter your Azure app's client ID."
        )

    state = secrets.token_urlsafe(20)
    _pending_states[state] = {"username": username, "client_id": client_id}

    # Simple size cap to avoid unbounded growth
    if len(_pending_states) > 100:
        oldest = list(_pending_states.keys())[:50]
        for k in oldest:
            _pending_states.pop(k, None)

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": _redirect_uri(request),
        "scope": _SCOPES,
        "state": state,
        "response_mode": "query",
        "prompt": "select_account",
    }
    if username:
        params["login_hint"] = username

    url = f"{_MS_AUTHORITY}/authorize?" + urllib.parse.urlencode(params)
    return {"url": url}


@router.get("/microsoft/callback")
async def microsoft_oauth_callback(
    request: Request,
    background_tasks: BackgroundTasks,
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
):
    """Handle Microsoft OAuth2 redirect. Exchanges code for token, saves account."""
    if error:
        msg = error_description or error
        return HTMLResponse(_callback_page(success=False, message=msg))

    if not code:
        return HTMLResponse(_callback_page(success=False, message="No authorization code received"))

    if state not in _pending_states:
        return HTMLResponse(_callback_page(success=False, message="Invalid or expired session — please try again"))

    entry = _pending_states.pop(state)
    client_id = entry["client_id"]
    hint_username = entry.get("username", "")

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{_MS_AUTHORITY}/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": client_id,
                    "code": code,
                    "redirect_uri": _redirect_uri(request),
                    "scope": _SCOPES,
                },
            )
        data = r.json()
    except Exception as e:
        return HTMLResponse(_callback_page(success=False, message=f"Token exchange failed: {e}"))

    if "access_token" not in data:
        msg = data.get("error_description") or data.get("error", "Token exchange failed")
        return HTMLResponse(_callback_page(success=False, message=msg))

    access_token = data["access_token"]
    refresh_token = data.get("refresh_token", "")

    # Resolve actual email address from Graph /me
    username = hint_username
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            me = await client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        me_data = me.json()
        username = me_data.get("mail") or me_data.get("userPrincipalName") or hint_username
    except Exception:
        pass

    cache = request.app.state.cache
    accounts = cache.list_accounts()

    # Update token for existing account, or add new one
    matched = False
    for acc in accounts:
        if acc.username.lower() == username.lower():
            cache.store_account_token(acc.id, access_token, refresh_token=refresh_token)
            matched = True
            break

    if not matched and username:
        from models import Account
        new_acc = Account(
            provider="hotmail",
            username=username,
            client_id=client_id,
            access_token=access_token,
        )
        # Bypass test_connection — token already validated via Graph /me above
        aid = cache.add_account(new_acc)
        new_acc.id = aid

        # Trigger email ingest in the background
        rag = request.app.state.rag

        async def _bg():
            from routers.accounts import _ingest_account, set_progress, IngestProgress
            set_progress(IngestProgress(status="running", message="Importing Microsoft emails…"))
            try:
                new, skip = await _ingest_account(new_acc, rag, cache)
                rag.flush_bm25()
                set_progress(IngestProgress(
                    status="completed", processed=new + skip, total=new + skip,
                    message=f"Done — {new} new emails imported",
                ))
            except Exception as e:
                set_progress(IngestProgress(status="error", message=str(e)))

        background_tasks.add_task(_bg)

    return HTMLResponse(_callback_page(success=True, username=username))


# ── Device code flow (fallback) ───────────────────────────────────────────────

@router.post("/microsoft/start")
async def start_microsoft_oauth(body: dict, request: Request):
    """Start a Microsoft device-code flow. Falls back to this if redirect flow is unavailable."""
    client_id = (body.get("client_id") or "").strip() or _get_stored_client_id()
    username = (body.get("username") or "").strip()
    if not client_id:
        raise HTTPException(400, "Microsoft App Client ID not configured in App Settings")

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{_MS_AUTHORITY}/devicecode",
            data={"client_id": client_id, "scope": _SCOPES, "login_hint": username},
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
    if len(_flows) > 100:
        for k in list(_flows.keys())[:50]:
            _flows.pop(k, None)

    user_code = data["user_code"]
    verification_uri = data["verification_uri"]
    # Build the pre-filled URL — removes dash so the otc param works correctly
    otc = user_code.replace("-", "").replace(" ", "")
    complete = data.get("verification_uri_complete") or f"{verification_uri}?otc={otc}"

    return {
        "flow_id": flow_id,
        "user_code": user_code,
        "verification_uri": verification_uri,
        "verification_uri_complete": complete,
        "expires_in": data.get("expires_in", 900),
    }


@router.get("/microsoft/poll")
async def poll_microsoft_oauth(flow_id: str, request: Request):
    """Poll device-code flow. Returns status: pending | completed."""
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
        refresh_token = data.get("refresh_token", "")
        username = entry["username"]
        del _flows[flow_id]

        cache = request.app.state.cache
        for acc in cache.list_accounts():
            if acc.username.lower() == username.lower():
                cache.store_account_token(acc.id, access_token, refresh_token=refresh_token)
                break

        return {"status": "completed", "username": username}

    error = data.get("error", "")
    if error in ("authorization_pending", "slow_down"):
        return {"status": "pending"}
    if error == "expired_token":
        del _flows[flow_id]
        raise HTTPException(400, "Code expired — please start again")

    del _flows[flow_id]
    raise HTTPException(400, data.get("error_description") or error)


# ── Auto-setup via Azure CLI ──────────────────────────────────────────────────

_REDIRECT_URI = "http://localhost:8000/api/oauth/microsoft/callback"


@router.post("/microsoft/auto-setup")
async def auto_setup_microsoft_app(request: Request):
    """Auto-create Azure app via Graph API using Azure CLI session."""
    import asyncio, shutil, json as _j
    from routers.config import load_app_config, save_app_config

    if not shutil.which("az"):
        return {"status": "needs_cli", "message": "Azure CLI not installed.", "fix": "brew install azure-cli"}

    async def _run(*args, timeout=20):
        proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill(); return -1, b"", b"timeout"
        return proc.returncode, out, err

    # Check login — az account show fails if not logged in
    rc, _, _ = await _run("az", "account", "show")
    if rc != 0:
        rc2, _, _ = await _run("az", "account", "show", "--allow-no-subscriptions")
        if rc2 != 0:
            await asyncio.create_subprocess_exec(
                "az", "login",
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            return {"status": "login_required", "message": "Azure sign-in opened in your browser — sign in, then click Continue Setup."}

    # Find existing app via Graph API (works for personal accounts)
    rc, out, _ = await _run(
        "az", "rest", "--method", "GET",
        "--url", f"https://graph.microsoft.com/v1.0/applications?$filter=displayName+eq+'Director+Assistant'",
        timeout=30,
    )
    client_id = ""
    obj_id = ""
    if rc == 0:
        try:
            items = _j.loads(out.decode()).get("value", [])
            if items:
                client_id = items[0].get("appId", "")
                obj_id = items[0].get("id", "")
        except Exception:
            pass

    if obj_id:
        # Update existing app to ensure public client flows enabled
        await _run(
            "az", "rest", "--method", "PATCH",
            "--url", f"https://graph.microsoft.com/v1.0/applications/{obj_id}",
            "--body", _j.dumps({"isFallbackPublicClient": True,
                                "publicClient": {"redirectUris": [_REDIRECT_URI]}}),
            timeout=30,
        )
    else:
        # Create new app via Graph API
        body = _j.dumps({
            "displayName": "Director Assistant",
            "signInAudience": "PersonalMicrosoftAccount",
            "isFallbackPublicClient": True,
            "publicClient": {"redirectUris": [_REDIRECT_URI]},
        })
        rc, out, err = await _run(
            "az", "rest", "--method", "POST",
            "--url", "https://graph.microsoft.com/v1.0/applications",
            "--body", body,
            timeout=60,
        )
        if rc != 0:
            return {"status": "error", "message": f"App creation failed: {err.decode()[:300]}"}
        try:
            data = _j.loads(out.decode())
            client_id = data.get("appId", "")
        except Exception:
            return {"status": "error", "message": "Could not parse app ID from response"}

    if not client_id:
        return {"status": "error", "message": "Could not obtain app client ID"}

    cfg = load_app_config()
    cfg["ms_client_id"] = client_id
    save_app_config(cfg)
    return {"status": "done", "client_id": client_id}


# ── Google OAuth2 ─────────────────────────────────────────────────────────────

_GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
_GOOGLE_SCOPES = (
    "openid email "
    "https://www.googleapis.com/auth/gmail.modify "
    "https://www.googleapis.com/auth/calendar.readonly"
)


def _google_client_creds() -> tuple[str, str]:
    from routers.config import load_app_config
    cfg = load_app_config()
    return (cfg.get("google_client_id") or "").strip(), (cfg.get("google_client_secret") or "").strip()


def _google_redirect_uri(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/oauth/google/callback"


@router.get("/google/auth-url")
async def get_google_auth_url(request: Request, username: str = ""):
    client_id, _ = _google_client_creds()
    if not client_id:
        raise HTTPException(
            400,
            "Google Client ID not configured. "
            "Go to App Settings → Google Client ID and enter your Google Cloud OAuth client ID."
        )
    state = secrets.token_urlsafe(20)
    _google_states[state] = {"username": username}
    if len(_google_states) > 100:
        for k in list(_google_states.keys())[:50]:
            _google_states.pop(k, None)

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": _google_redirect_uri(request),
        "scope": _GOOGLE_SCOPES,
        "state": state,
        "access_type": "offline",
        "prompt": "select_account consent",
    }
    if username:
        params["login_hint"] = username
    url = _GOOGLE_AUTH + "?" + urllib.parse.urlencode(params)
    return {"url": url}


@router.get("/google/callback")
async def google_oauth_callback(
    request: Request,
    background_tasks: BackgroundTasks,
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
):
    if error:
        return HTMLResponse(_callback_page(success=False, message=error_description or error))
    if not code:
        return HTMLResponse(_callback_page(success=False, message="No authorization code received"))
    if state not in _google_states:
        return HTMLResponse(_callback_page(success=False, message="Invalid or expired session — please try again"))

    entry = _google_states.pop(state)
    client_id, client_secret = _google_client_creds()
    redirect_uri = _google_redirect_uri(request)

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(_GOOGLE_TOKEN, data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            })
        data = r.json()
    except Exception as e:
        return HTMLResponse(_callback_page(success=False, message=f"Token exchange failed: {e}"))

    if "access_token" not in data:
        msg = data.get("error_description") or data.get("error", "Token exchange failed")
        return HTMLResponse(_callback_page(success=False, message=msg))

    access_token = data["access_token"]
    refresh_token = data.get("refresh_token", "")

    # Resolve email from Google userinfo
    username = entry.get("username", "")
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            ui = await c.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        ui_data = ui.json()
        username = ui_data.get("email") or username
    except Exception:
        pass

    cache = request.app.state.cache
    accounts = cache.list_accounts()

    # Update token for existing account or add new one
    matched = False
    for acc in accounts:
        if acc.username.lower() == username.lower():
            cache.store_account_token(acc.id, access_token, refresh_token=refresh_token)
            matched = True
            break

    if not matched and username:
        import json as _j
        from models import Account
        new_acc = Account(
            provider="gmail",
            username=username,
            client_id=client_id,
            client_secret=client_secret,
            access_token=access_token,
        )
        aid = cache.add_account(new_acc)
        new_acc.id = aid
        # Store token_provider so refresh uses Google endpoint
        with cache._conn() as conn:
            row = conn.execute("SELECT config_json FROM accounts WHERE id = ?", (aid,)).fetchone()
            if row:
                cfg = _j.loads(row[0] or "{}")
                cfg["token_provider"] = "google"
                cfg["refresh_token"] = refresh_token
                cfg["client_secret"] = client_secret
                conn.execute("UPDATE accounts SET config_json = ? WHERE id = ?", (_j.dumps(cfg), aid))

        rag = request.app.state.rag

        async def _bg():
            from routers.accounts import _ingest_account, set_progress, IngestProgress
            set_progress(IngestProgress(status="running", message="Importing Gmail emails…"))
            try:
                new, skip = await _ingest_account(new_acc, rag, cache)
                rag.flush_bm25()
                set_progress(IngestProgress(
                    status="completed", processed=new + skip, total=new + skip,
                    message=f"Done — {new} new emails imported",
                ))
            except Exception as e:
                set_progress(IngestProgress(status="error", message=str(e)))

        background_tasks.add_task(_bg)

    return HTMLResponse(_callback_page(success=True, username=username))
