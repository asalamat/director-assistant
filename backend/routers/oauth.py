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
_oauth_bg_procs: dict[str, object] = {}  # background subprocesses (e.g. az login)
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


def _find_az() -> str | None:
    """Locate the Azure CLI executable, including Windows az.cmd locations."""
    import sys as _sys, os as _os, shutil as _sh
    az = _sh.which("az")
    if az:
        return az
    if _sys.platform == "win32":
        candidates = [
            r"C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
            r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
            _os.path.join(_os.environ.get("LOCALAPPDATA", ""), r"Programs\Azure CLI\wbin\az.cmd"),
            _os.path.join(_os.environ.get("ProgramFiles(x86)", ""), r"Microsoft SDKs\Azure\CLI2\wbin\az.cmd"),
            _os.path.join(_os.environ.get("ProgramFiles", ""), r"Microsoft SDKs\Azure\CLI2\wbin\az.cmd"),
        ]
        for c in candidates:
            if _os.path.exists(c):
                return c
    return None


def _az_cmd(az_path: str, *args: str) -> tuple:
    """Wrap az.cmd in 'cmd /c' on Windows — CreateProcess can't run .cmd directly."""
    if az_path.lower().endswith(".cmd"):
        return ("cmd", "/c", az_path) + args
    return (az_path,) + args


@router.post("/microsoft/auto-setup")
async def auto_setup_microsoft_app(request: Request):
    """Auto-create Azure app via Graph API using Azure CLI session."""
    import asyncio, json as _j
    from routers.config import load_app_config, save_app_config

    az_exe = _find_az()
    if not az_exe:
        import sys as _sys
        fix = "brew install azure-cli" if _sys.platform == "darwin" else "winget install Microsoft.AzureCLI"
        return {"status": "needs_cli",
                "message": "Azure CLI not installed.",
                "fix": fix}

    import subprocess as _sp, functools as _ft
    import sys as _sys

    def _run_sync(*args, timeout=20):
        """Run a subprocess synchronously — avoids SelectorEventLoop issues on Windows."""
        try:
            r = _sp.run(
                list(args), capture_output=True, timeout=timeout,
                creationflags=_sp.CREATE_NO_WINDOW if _sys.platform == "win32" else 0,
            )
            return r.returncode, r.stdout, r.stderr
        except _sp.TimeoutExpired:
            return -1, b"", b"timeout"
        except Exception as e:
            return -1, b"", str(e).encode()

    loop = asyncio.get_event_loop()

    async def _run(*args, timeout=20):
        return await loop.run_in_executor(
            None, _ft.partial(_run_sync, *args, timeout=timeout)
        )

    # Check login — az account show fails if not logged in
    rc, _, _ = await _run(*_az_cmd(az_exe, "account", "show"))
    if rc != 0:
        rc2, _, _ = await _run(*_az_cmd(az_exe, "account", "show", "--allow-no-subscriptions"))
        if rc2 != 0:
            # Use device code flow: outputs URL+code immediately, doesn't need to open a browser
            # from within the server process (avoids CREATE_NO_WINDOW / capture_output issues)
            device_url = "https://microsoft.com/devicelogin"
            device_code = ""
            try:
                import re as _re, threading as _thr, time as _time, subprocess as _sp2
                proc = _sp2.Popen(
                    list(_az_cmd(az_exe, "login", "--use-device-code")),
                    stdout=_sp2.PIPE, stderr=_sp2.STDOUT,
                    creationflags=_sp2.CREATE_NO_WINDOW if _sys.platform == "win32" else 0,
                )
                # Store so it keeps running in background after we return
                _oauth_bg_procs["az_login"] = proc
                # Read output for up to 8 seconds to capture device code
                collected: list[str] = []
                def _read():
                    for raw in proc.stdout:
                        collected.append(raw.decode(errors="replace"))
                _thr.Thread(target=_read, daemon=True).start()
                deadline = _time.time() + 8
                while _time.time() < deadline:
                    for line in collected:
                        m = _re.search(r"\b([A-Z0-9]{8,9})\b", line)
                        if m and ("microsoft.com" in line or "devicelogin" in line.lower()):
                            device_code = m.group(1)
                            break
                    if device_code:
                        break
                    _time.sleep(0.25)
            except Exception:
                pass
            # Open device login page in the user's default browser
            try:
                import webbrowser as _wb
                _wb.open(device_url)
            except Exception:
                pass
            msg = f"Browser opened to {device_url}"
            if device_code:
                msg += f" — enter code {device_code} when prompted."
            else:
                msg += " — sign in, then click Continue Setup."
            return {"status": "login_required", "message": msg,
                    "device_code": device_code, "device_url": device_url}

    # Find existing app via Graph API (works for personal accounts)
    rc, out, _ = await _run(
        *_az_cmd(az_exe, "rest", "--method", "GET",
                 "--url", "https://graph.microsoft.com/v1.0/applications?$filter=displayName+eq+'Director+Assistant'"),
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
            *_az_cmd(az_exe, "rest", "--method", "PATCH",
                     "--url", f"https://graph.microsoft.com/v1.0/applications/{obj_id}",
                     "--body", _j.dumps({"isFallbackPublicClient": True,
                                         "publicClient": {"redirectUris": [_REDIRECT_URI]}})),
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
            *_az_cmd(az_exe, "rest", "--method", "POST",
                     "--url", "https://graph.microsoft.com/v1.0/applications",
                     "--body", body),
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
    "https://www.googleapis.com/auth/calendar.readonly "
    "https://www.googleapis.com/auth/contacts.readonly"
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


# ── Instagram (Facebook) OAuth2 ───────────────────────────────────────────────

_FACEBOOK_AUTH = "https://www.facebook.com/v19.0/dialog/oauth"
_FACEBOOK_TOKEN = "https://graph.facebook.com/v19.0/oauth/access_token"
_GRAPH_IG_BASE = "https://graph.facebook.com/v19.0"
_IG_SCOPES = "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_metadata,business_management"
_ig_states: dict[str, dict] = {}


def _ig_app_creds() -> tuple[str, str]:
    from routers.config import load_app_config
    cfg = load_app_config().get("instagram", {}) or {}
    return (cfg.get("app_id") or "").strip(), (cfg.get("app_secret") or "").strip()


def _ig_redirect_uri(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/api/oauth/instagram/callback"


def _ig_callback_page(success: bool, username: str = "", message: str = "", note: str = "") -> str:
    import html as _h
    if success:
        data = json.dumps({"type": "ig-oauth-complete", "username": username, "note": note})
        sub = f"@{_h.escape(username)}" if username else (_h.escape(note) if note else "Token saved successfully")
        body = (
            f'<div style="text-align:center;padding:60px;font-family:system-ui,sans-serif">'
            f'<div style="font-size:48px">✓</div>'
            f'<h2 style="color:#16a34a;margin:16px 0 8px">Instagram connected</h2>'
            f'<p style="color:#6b7280">{sub}</p>'
            f'<p style="color:#9ca3af;font-size:13px;margin-top:24px">This window will close automatically…</p>'
            f'</div>'
        )
    else:
        data = json.dumps({"type": "ig-oauth-error", "message": message})
        body = (
            f'<div style="text-align:center;padding:60px;font-family:system-ui,sans-serif">'
            f'<div style="font-size:48px">✗</div>'
            f'<h2 style="color:#dc2626;margin:16px 0 8px">Connection failed</h2>'
            f'<p style="color:#6b7280">{_h.escape(message)}</p>'
            f'<button onclick="window.close()" style="margin-top:24px;padding:8px 20px;border-radius:8px;'
            f'border:1px solid #d1d5db;background:#f9fafb;cursor:pointer;font-size:14px">Close</button>'
            f'</div>'
        )
    return (
        f'<!DOCTYPE html><html><head><meta charset="utf-8"><title>Instagram Connect</title></head>'
        f'<body style="margin:0;background:#f9fafb">{body}'
        f'<script>var data={data};'
        f'try{{window.opener&&window.opener.postMessage(data,window.location.origin);}}catch(e){{}}'
        f'if(data.type==="ig-oauth-complete"){{setTimeout(function(){{window.close();}},1200);}}'
        f'</script></body></html>'
    )


@router.get("/instagram/auth-url")
async def get_instagram_auth_url(request: Request):
    app_id, _ = _ig_app_creds()
    if not app_id:
        raise HTTPException(400, "Facebook App ID not configured — add it in Settings → Instagram → App ID")
    state = secrets.token_urlsafe(20)
    _ig_states[state] = {}
    if len(_ig_states) > 100:
        for k in list(_ig_states.keys())[:50]:
            _ig_states.pop(k, None)
    params = {
        "client_id": app_id, "redirect_uri": _ig_redirect_uri(request),
        "scope": _IG_SCOPES, "state": state, "response_type": "code",
    }
    return {"url": _FACEBOOK_AUTH + "?" + urllib.parse.urlencode(params)}


@router.get("/instagram/callback")
async def instagram_oauth_callback(
    request: Request,
    code: str = "", state: str = "", error: str = "", error_description: str = "",
):
    if error:
        return HTMLResponse(_ig_callback_page(False, message=error_description or error))
    if not code:
        return HTMLResponse(_ig_callback_page(False, message="No authorization code received"))
    if state not in _ig_states:
        return HTMLResponse(_ig_callback_page(False, message="Invalid or expired session — please try again"))
    _ig_states.pop(state)
    app_id, app_secret = _ig_app_creds()

    # Step 1: code → short-lived token
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(_FACEBOOK_TOKEN, params={
                "client_id": app_id, "client_secret": app_secret,
                "redirect_uri": _ig_redirect_uri(request), "code": code,
            })
        tok_data = r.json()
    except Exception as e:
        return HTMLResponse(_ig_callback_page(False, message=f"Token exchange failed: {e}"))
    if "access_token" not in tok_data:
        msg = (tok_data.get("error") or {}).get("message") or tok_data.get("error_description") or "Token exchange failed"
        return HTMLResponse(_ig_callback_page(False, message=msg))
    short_token = tok_data["access_token"]

    # Step 2: short → long-lived token (60 days)
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{_GRAPH_IG_BASE}/oauth/access_token", params={
                "grant_type": "fb_exchange_token", "client_id": app_id,
                "client_secret": app_secret, "fb_exchange_token": short_token,
            })
        long_token = r.json().get("access_token", short_token)
    except Exception:
        long_token = short_token

    # Step 3: find Instagram Business/Creator Account ID — three attempts
    ig_user_id = ""
    ig_username = ""

    # Attempt A: via Facebook Pages (standard Business accounts)
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            pages_r = await c.get(f"{_GRAPH_IG_BASE}/me/accounts",
                params={"access_token": long_token, "fields": "id,name,instagram_business_account"})
        for page in pages_r.json().get("data", []):
            ib = page.get("instagram_business_account") or {}
            if ib.get("id"):
                ig_user_id = ib["id"]
                async with httpx.AsyncClient(timeout=10) as c:
                    pu = await c.get(f"{_GRAPH_IG_BASE}/{ig_user_id}",
                        params={"fields": "username", "access_token": long_token})
                ig_username = pu.json().get("username", "")
                break
    except Exception:
        pass

    # Attempt B: direct user node (works for some Creator accounts)
    if not ig_user_id:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                me_r = await c.get(f"{_GRAPH_IG_BASE}/me",
                    params={"access_token": long_token, "fields": "id,name,instagram_business_account"})
            ib = me_r.json().get("instagram_business_account") or {}
            if ib.get("id"):
                ig_user_id = ib["id"]
                async with httpx.AsyncClient(timeout=10) as c:
                    pu = await c.get(f"{_GRAPH_IG_BASE}/{ig_user_id}",
                        params={"fields": "username", "access_token": long_token})
                ig_username = pu.json().get("username", "")
        except Exception:
            pass

    # Step 4: persist token regardless — user can enter Account ID manually if auto-detect failed
    from routers.config import load_app_config, save_app_config
    cfg = load_app_config()
    ig_cfg = cfg.get("instagram", {}) or {}
    ig_cfg["access_token"] = long_token
    if ig_user_id:
        ig_cfg["ig_user_id"] = ig_user_id
        ig_cfg["username"] = ig_username
    cfg["instagram"] = ig_cfg
    save_app_config(cfg)

    if ig_user_id:
        return HTMLResponse(_ig_callback_page(True, username=ig_username))

    # Token saved but account not auto-detected — ask user to enter Account ID manually
    return HTMLResponse(_ig_callback_page(True, username="",
        note="Token saved — Instagram account ID not auto-detected. Enter it manually in Settings."))


# ── Instagram Direct Login (no Facebook Page required) ────────────────────────

_IG_LOGIN_AUTH = "https://api.instagram.com/oauth/authorize"
_IG_LOGIN_TOKEN = "https://api.instagram.com/oauth/access_token"
_IG_LOGIN_GRAPH = "https://graph.instagram.com/v21.0"
_IG_LOGIN_SCOPES = "instagram_business_basic,instagram_business_content_publish"
_ig_login_states: dict[str, dict] = {}


def _ig_login_app_creds() -> tuple[str, str]:
    from routers.config import load_app_config
    cfg = load_app_config().get("instagram", {}) or {}
    return (cfg.get("ig_login_app_id") or "").strip(), (cfg.get("ig_login_app_secret") or "").strip()


def _ig_login_redirect_uri(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/api/oauth/instagram-login/callback"


@router.get("/instagram-login/auth-url")
async def get_instagram_login_auth_url(request: Request):
    app_id, _ = _ig_login_app_creds()
    if not app_id:
        raise HTTPException(400, "Instagram App ID not configured — add it in Settings → Instagram → Instagram Login section")
    state = secrets.token_urlsafe(20)
    _ig_login_states[state] = {}
    if len(_ig_login_states) > 100:
        for k in list(_ig_login_states.keys())[:50]:
            _ig_login_states.pop(k, None)
    params = {
        "client_id": app_id, "redirect_uri": _ig_login_redirect_uri(request),
        "scope": _IG_LOGIN_SCOPES, "state": state, "response_type": "code",
    }
    return {"url": _IG_LOGIN_AUTH + "?" + urllib.parse.urlencode(params)}


@router.get("/instagram-login/callback")
async def instagram_login_callback(
    request: Request,
    code: str = "", state: str = "", error: str = "", error_description: str = "",
):
    if error:
        return HTMLResponse(_ig_callback_page(False, message=error_description or error))
    if not code:
        return HTMLResponse(_ig_callback_page(False, message="No authorization code received"))
    if state not in _ig_login_states:
        return HTMLResponse(_ig_callback_page(False, message="Invalid or expired session — please try again"))
    _ig_login_states.pop(state)
    app_id, app_secret = _ig_login_app_creds()

    # Step 1: code → short-lived token (POST to api.instagram.com)
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(_IG_LOGIN_TOKEN, data={
                "client_id": app_id, "client_secret": app_secret,
                "grant_type": "authorization_code",
                "redirect_uri": _ig_login_redirect_uri(request), "code": code,
            })
        tok_data = r.json()
    except Exception as e:
        return HTMLResponse(_ig_callback_page(False, message=f"Token exchange failed: {e}"))
    if "access_token" not in tok_data:
        msg = tok_data.get("error_message") or tok_data.get("error_description") or str(tok_data)[:300]
        return HTMLResponse(_ig_callback_page(False, message=msg))
    short_token = tok_data["access_token"]

    # Step 2: exchange for long-lived token (60 days)
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{_IG_LOGIN_GRAPH}/access_token", params={
                "grant_type": "ig_exchange_token", "client_id": app_id,
                "client_secret": app_secret, "access_token": short_token,
            })
        long_token = r.json().get("access_token", short_token)
    except Exception:
        long_token = short_token

    # Step 3: get IG user ID and username directly — no Facebook Page needed
    ig_user_id = ""
    ig_username = ""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            me_r = await c.get(f"{_IG_LOGIN_GRAPH}/me",
                params={"fields": "id,username", "access_token": long_token})
        me_data = me_r.json()
        ig_user_id = me_data.get("id", "")
        ig_username = me_data.get("username", "")
    except Exception:
        pass

    # Step 4: persist
    from routers.config import load_app_config, save_app_config
    cfg = load_app_config()
    ig_cfg = cfg.get("instagram", {}) or {}
    ig_cfg["access_token"] = long_token
    ig_cfg["token_type"] = "instagram_login"
    if ig_user_id:
        ig_cfg["ig_user_id"] = ig_user_id
        ig_cfg["username"] = ig_username
    cfg["instagram"] = ig_cfg
    save_app_config(cfg)

    if ig_user_id:
        return HTMLResponse(_ig_callback_page(True, username=ig_username))
    return HTMLResponse(_ig_callback_page(True, username="",
        note="Token saved — enter your Instagram Account ID in Settings if not auto-filled."))
