"""App configuration API — replaces manual .env editing."""

import json
import os
import re
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

APP_CONFIG_PATH = Path.home() / ".director-assistant" / "app-config.json"

router = APIRouter(prefix="/api/config", tags=["config"])


def load_app_config() -> dict:
    if APP_CONFIG_PATH.exists():
        try:
            return json.loads(APP_CONFIG_PATH.read_text())
        except Exception:
            pass
    return {}


def save_app_config(data: dict):
    APP_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    APP_CONFIG_PATH.write_text(json.dumps(data, indent=2))
    APP_CONFIG_PATH.chmod(0o600)


def get_effective_api_key() -> str:
    """Anthropic key: config file takes precedence over .env."""
    cfg = load_app_config()
    return cfg.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY", "")


class AppConfigUpdate(BaseModel):
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    ms_client_id: Optional[str] = None
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    poll_interval_seconds: Optional[int] = None
    budget_mode: Optional[bool] = None
    sync_window_days: Optional[int] = None
    digest_schedule_enabled: Optional[bool] = None
    digest_schedule_time: Optional[str] = None   # "HH:MM"
    digest_schedule_email: Optional[str] = None


@router.get("")
async def get_config():
    cfg = load_app_config()
    ant_key = cfg.get("anthropic_api_key", "")
    oai_key = cfg.get("openai_api_key", "")
    ms_id = cfg.get("ms_client_id", "")
    g_id = cfg.get("google_client_id", "")
    return {
        "has_api_key": bool(ant_key),
        "api_key_preview": f"{ant_key[:8]}…" if ant_key else "",
        "has_openai_key": bool(oai_key),
        "openai_key_preview": f"{oai_key[:8]}…" if oai_key else "",
        "ms_client_id": ms_id,
        "has_ms_client_id": bool(ms_id),
        "google_client_id": g_id,
        "has_google_client_id": bool(g_id),
        "poll_interval_seconds": cfg.get("poll_interval_seconds", 60),
        "budget_mode": cfg.get("budget_mode", False),
        "sync_window_days": cfg.get("sync_window_days", 0),
        "digest_schedule_enabled": cfg.get("digest_schedule_enabled", False),
        "digest_schedule_time": cfg.get("digest_schedule_time", "08:00"),
        "digest_schedule_email": cfg.get("digest_schedule_email", ""),
    }


@router.post("")
async def update_config(update: AppConfigUpdate, request: Request):
    cfg = load_app_config()

    if update.anthropic_api_key is not None:
        cfg["anthropic_api_key"] = update.anthropic_api_key

    if update.openai_api_key is not None:
        cfg["openai_api_key"] = update.openai_api_key

    if update.ms_client_id is not None:
        cfg["ms_client_id"] = update.ms_client_id.strip()

    if update.google_client_id is not None:
        cfg["google_client_id"] = update.google_client_id.strip()

    if update.google_client_secret is not None:
        cfg["google_client_secret"] = update.google_client_secret.strip()

    if update.digest_schedule_enabled is not None:
        cfg["digest_schedule_enabled"] = update.digest_schedule_enabled
    if update.digest_schedule_time is not None:
        t = update.digest_schedule_time.strip()
        if not re.match(r"^\d{2}:\d{2}$", t):
            raise HTTPException(400, "digest_schedule_time must be HH:MM (e.g. '08:00')")
        cfg["digest_schedule_time"] = t
    if update.digest_schedule_email is not None:
        cfg["digest_schedule_email"] = update.digest_schedule_email.strip()

    if update.poll_interval_seconds is not None:
        cfg["poll_interval_seconds"] = update.poll_interval_seconds

    if update.budget_mode is not None:
        cfg["budget_mode"] = update.budget_mode

    if update.sync_window_days is not None:
        # 0 = unlimited; positive values must be at least 1
        cfg["sync_window_days"] = 0 if update.sync_window_days == 0 else max(1, update.sync_window_days)

    save_app_config(cfg)

    # Hot-reload keys + budget mode into the shared AIClient
    ant_key = cfg.get("anthropic_api_key", "")
    oai_key = cfg.get("openai_api_key", "")
    budget = cfg.get("budget_mode", False)
    for svc_name in ("rag", "advisor", "digest", "classifier"):
        obj = getattr(request.app.state, svc_name, None)
        if obj and hasattr(obj, "ai"):
            ai = obj.ai
            if hasattr(ai, "update_keys"):
                ai.update_keys(anthropic_key=ant_key or None,
                               openai_key=oai_key or None,
                               budget_mode=budget)

    # Restart the poll loop so the new interval takes effect immediately
    if update.poll_interval_seconds is not None:
        restart = getattr(request.app.state, "restart_poll", None)
        if restart:
            restart()

    return {
        "status": "saved",
        "has_api_key": bool(ant_key),
        "has_openai_key": bool(oai_key),
    }


@router.post("/test-key")
async def test_api_key(update: AppConfigUpdate):
    """Validate an Anthropic API key by making a minimal API call."""
    key = update.anthropic_api_key or ""
    if not key:
        return {"valid": False, "error": "No key provided"}
    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=key)
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=5,
            messages=[{"role": "user", "content": "Hi"}],
        )
        return {"valid": True, "model": resp.model}
    except anthropic.AuthenticationError:
        return {"valid": False, "error": "Invalid API key"}
    except Exception as e:
        return {"valid": False, "error": str(e)}


@router.post("/test-openai-key")
async def test_openai_key(update: AppConfigUpdate):
    """Validate an OpenAI API key by making a minimal API call."""
    key = update.openai_api_key or ""
    if not key:
        return {"valid": False, "error": "No key provided"}
    try:
        from openai import AsyncOpenAI, AuthenticationError
        client = AsyncOpenAI(api_key=key)
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=5,
            messages=[{"role": "user", "content": "Hi"}],
        )
        return {"valid": True, "model": resp.model}
    except AuthenticationError:
        return {"valid": False, "error": "Invalid API key"}
    except Exception as e:
        return {"valid": False, "error": str(e)}
