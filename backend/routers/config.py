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
    translation_language: Optional[str] = None   # e.g. "English", "French"
    # Webhooks / Zapier
    webhook_urls: Optional[list] = None
    webhook_events: Optional[list] = None
    # Slack / Teams
    slack_webhook_url: Optional[str] = None
    teams_webhook_url: Optional[str] = None
    slack_vip_notify: Optional[bool] = None
    slack_auto_urgent: Optional[bool] = None
    teams_vip_notify: Optional[bool] = None
    teams_auto_urgent: Optional[bool] = None
    # Task export (Notion / Jira / Todoist)
    notion_api_key: Optional[str] = None
    notion_database_id: Optional[str] = None
    jira_url: Optional[str] = None
    jira_email: Optional[str] = None
    jira_api_token: Optional[str] = None
    jira_project_key: Optional[str] = None
    todoist_api_token: Optional[str] = None
    # Scheduled report email
    report_email_enabled: Optional[bool] = None
    report_email_schedule: Optional[str] = None
    report_email_to: Optional[str] = None


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
        "translation_language": cfg.get("translation_language", "English"),
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
    if update.translation_language is not None:
        cfg["translation_language"] = update.translation_language.strip()

    # Integration settings — save any non-None values directly
    for key in (
        "webhook_urls", "webhook_events",
        "slack_webhook_url", "teams_webhook_url",
        "slack_vip_notify", "slack_auto_urgent", "teams_vip_notify", "teams_auto_urgent",
        "notion_api_key", "notion_database_id",
        "jira_url", "jira_email", "jira_api_token", "jira_project_key",
        "todoist_api_token",
        "report_email_enabled", "report_email_to",
    ):
        val = getattr(update, key, None)
        if val is not None:
            cfg[key] = val
    if update.report_email_schedule is not None:
        import re as _re
        if not _re.match(r'^(monday|tuesday|wednesday|thursday|friday|saturday|sunday):\d{2}:\d{2}$',
                         update.report_email_schedule):
            raise HTTPException(400, "report_email_schedule must be 'weekday:HH:MM' e.g. 'monday:07:00'")
        cfg["report_email_schedule"] = update.report_email_schedule

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


# ── AI Provider management ────────────────────────────────────────────────────

_PROVIDER_DEFAULTS = {
    "anthropic":         {"label": "Anthropic Claude",    "base_url": ""},
    "openai":            {"label": "OpenAI GPT",          "base_url": ""},
    "groq":              {"label": "Groq (Llama/Mixtral)", "base_url": "https://api.groq.com/openai/v1"},
    "gemini":            {"label": "Google Gemini",        "base_url": ""},
    "ollama":            {"label": "Ollama (Local)",       "base_url": "http://localhost:11434/v1"},
    "kimi":              {"label": "Kimi (Moonshot AI)",   "base_url": "https://api.moonshot.cn/v1"},
    "openai-compatible": {"label": "Custom OpenAI API",   "base_url": ""},
}

_DEFAULT_MODELS = {
    "anthropic":  ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"],
    "openai":     ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
    "groq":       ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"],
    "gemini":     ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-pro"],
    "ollama":     ["llama3.2", "llama3.1", "mistral", "phi3", "qwen2.5"],
    "kimi":       ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    "openai-compatible": [],
}


@router.get("/providers")
async def get_providers(request: Request):
    """Return the current AI provider list (keys masked)."""
    cfg = load_app_config()
    providers = cfg.get("ai_providers", [])
    if not providers:
        # Build defaults from legacy keys
        providers = []
        if cfg.get("anthropic_api_key"):
            providers.append({"type": "anthropic", "key": cfg["anthropic_api_key"],
                               "enabled": True, "priority": 1, "label": "Anthropic Claude"})
        if cfg.get("openai_api_key"):
            providers.append({"type": "openai", "key": cfg["openai_api_key"],
                               "enabled": True, "priority": 2, "label": "OpenAI GPT"})
    # Mask keys
    masked = []
    for p in providers:
        m = dict(p)
        k = m.get("key", "")
        m["key_preview"] = (k[:4] + "…" + k[-4:]) if len(k) > 8 else ("set" if k else "")
        m["key"] = ""  # never return full key
        masked.append(m)
    return {"providers": masked, "available_types": _PROVIDER_DEFAULTS,
            "available_models": _DEFAULT_MODELS}


class ProviderUpdate(BaseModel):
    providers: list[dict]


@router.post("/providers")
async def save_providers(body: ProviderUpdate, request: Request):
    """Save the AI provider list (with full keys)."""
    cfg = load_app_config()
    # Validate each provider has at least a type
    for p in body.providers:
        if "type" not in p:
            raise HTTPException(400, "Each provider must have a 'type'")
    # Preserve existing keys when new key is empty (frontend masks keys after first save)
    existing = {p.get("type", ""): p for p in cfg.get("ai_providers", [])}
    legacy_keys = {
        "anthropic": cfg.get("anthropic_api_key", ""),
        "openai":    cfg.get("openai_api_key", ""),
    }
    merged = []
    for p in body.providers:
        ptype = p.get("type", "")
        if not p.get("key"):
            # Try to restore from previous ai_providers entry
            prev = existing.get(ptype, {})
            if prev.get("key"):
                p = {**p, "key": prev["key"]}
            elif legacy_keys.get(ptype):
                p = {**p, "key": legacy_keys[ptype]}
        merged.append(p)

    cfg["ai_providers"] = merged
    # Keep legacy keys in sync for backward compat
    for p in merged:
        if p.get("type") == "anthropic" and p.get("key"):
            cfg["anthropic_api_key"] = p["key"]
        if p.get("type") == "openai" and p.get("key"):
            cfg["openai_api_key"] = p["key"]
    save_app_config(cfg)
    # Hot-reload the AI client
    client = request.app.state.advisor.ai
    client.update_providers(providers=body.providers)
    return {"saved": len(body.providers), "primary": body.providers[0]["type"] if body.providers else "none"}


@router.post("/providers/test")
async def test_provider(body: dict):
    """Test a single provider configuration by making a minimal API call."""
    provider_type = body.get("type", "")
    key = body.get("key", "")
    base_url = body.get("base_url", "")
    model = body.get("model", "")

    try:
        if provider_type == "anthropic":
            import anthropic as _ant
            c = _ant.AsyncAnthropic(api_key=key)
            resp = await c.messages.create(
                model=model or "claude-haiku-4-5-20251001", max_tokens=10,
                messages=[{"role": "user", "content": "Hi"}]
            )
            return {"valid": True, "model": resp.model, "provider": "anthropic"}

        elif provider_type in ("openai", "groq", "ollama", "kimi", "openai-compatible"):
            from openai import AsyncOpenAI
            defaults = {
                "groq":  "https://api.groq.com/openai/v1",
                "ollama":"http://localhost:11434/v1",
                "kimi":  "https://api.moonshot.cn/v1",
            }
            base = base_url or defaults.get(provider_type)
            kwargs: dict = {"api_key": key or "ollama"}
            if base:
                kwargs["base_url"] = base
            c = AsyncOpenAI(**kwargs)
            if not model:
                model = _DEFAULT_MODELS.get(provider_type, ["gpt-4o-mini"])[0]
            resp = await c.chat.completions.create(
                model=model, max_tokens=10,
                messages=[{"role": "user", "content": "Hi"}]
            )
            return {"valid": True, "model": resp.model, "provider": provider_type}

        elif provider_type == "gemini":
            target_model = model or "gemini-2.0-flash"
            # Try new google-genai SDK
            try:
                from google import genai as google_genai
                client = google_genai.Client(api_key=key)
                resp = await client.aio.models.generate_content(model=target_model, contents="Hi")
                return {"valid": True, "model": target_model, "provider": "gemini"}
            except ImportError:
                pass
            # Fallback to legacy SDK
            try:
                import google.generativeai as genai_legacy
                import warnings
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    genai_legacy.configure(api_key=key)
                    m = genai_legacy.GenerativeModel(target_model)
                    resp = await m.generate_content_async("Hi")
                return {"valid": True, "model": target_model, "provider": "gemini"}
            except ImportError:
                return {"valid": False, "error": "Install google-genai: pip install google-genai"}

        return {"valid": False, "error": f"Unknown provider type: {provider_type}"}

    except Exception as e:
        msg = str(e)
        if "auth" in msg.lower() or "key" in msg.lower() or "401" in msg:
            return {"valid": False, "error": "Invalid API key"}
        return {"valid": False, "error": msg[:200]}
