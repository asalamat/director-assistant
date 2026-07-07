"""
Keychain-backed storage for sensitive config values.

All secrets are stored in the OS keychain (macOS Keychain / Windows Credential
Manager / Linux Secret Service) under the service name "director-assistant-cfg".

If keyring is unavailable the functions degrade silently so the app still works
with secrets staying in the JSON file (same security level as before this module
was added).

Sentinel: when a value has been moved to the keychain the JSON file stores the
string "__keychain__" in its place so the app knows to look there.
"""

import json
from typing import Any

_KR_SERVICE = "director-assistant-cfg"
_SENTINEL = "__keychain__"

# Top-level string keys whose values should live in the keychain.
_SIMPLE_KEYS = {
    "openai_api_key",
    "anthropic_api_key",
    "elevenlabs_api_key",
    "google_client_secret",
    "notion_api_key",
    "jira_api_token",
    "todoist_api_token",
    "slack_webhook_url",
    "teams_webhook_url",
}

# Top-level keys that are JSON objects / lists — serialised as a whole.
_JSON_KEYS = {"ai_providers", "instagram", "linkedin"}

_SENSITIVE_KEYS = _SIMPLE_KEYS | _JSON_KEYS

# Cache so keychain is read at most once per process per key.
_cache: dict[str, str | None] = {}
_unavailable = False   # set True once we confirm keyring is broken


def _keyring():
    try:
        import keyring
        return keyring
    except ImportError:
        return None


def _kr_get(name: str) -> str | None:
    global _unavailable
    if _unavailable:
        return None
    if name in _cache:
        return _cache[name]
    kr = _keyring()
    if kr is None:
        _unavailable = True
        return None
    try:
        val = kr.get_password(_KR_SERVICE, name)
        _cache[name] = val
        return val
    except Exception:
        return None


def _kr_set(name: str, value: str) -> bool:
    global _unavailable
    if _unavailable:
        return False
    kr = _keyring()
    if kr is None:
        _unavailable = True
        return False
    try:
        kr.set_password(_KR_SERVICE, name, value)
        _cache[name] = value
        return True
    except Exception:
        return False


def _kr_delete(name: str):
    _cache.pop(name, None)
    kr = _keyring()
    if kr is None:
        return
    try:
        kr.delete_password(_KR_SERVICE, name)
    except Exception:
        pass


def overlay_from_keychain(cfg: dict) -> dict:
    """
    Return a copy of cfg with secrets replaced by real values from keychain.
    Call this after reading the JSON file.
    """
    out = dict(cfg)
    for key in _SIMPLE_KEYS:
        stored = out.get(key)
        if stored == _SENTINEL:
            real = _kr_get(key)
            out[key] = real if real is not None else ""
        # Also proactively pull from keychain even if not yet marked with sentinel
        # (first-run or after a fresh install from backup).
    for key in _JSON_KEYS:
        stored = out.get(key)
        if stored == _SENTINEL or stored is None:
            raw = _kr_get(key)
            if raw is not None:
                try:
                    out[key] = json.loads(raw)
                except Exception:
                    pass
    return out


def protect_to_keychain(cfg: dict) -> dict:
    """
    Move secrets from cfg into the OS keychain.
    Return a sanitised copy of cfg safe to write to disk
    (secrets replaced with sentinel or removed).
    """
    out = dict(cfg)
    for key in _SIMPLE_KEYS:
        val = out.get(key)
        if val and val != _SENTINEL:
            if _kr_set(key, val):
                out[key] = _SENTINEL
            # else leave plaintext (keychain unavailable)
    for key in _JSON_KEYS:
        val = out.get(key)
        if val is not None and val != _SENTINEL:
            serialised = json.dumps(val)
            if _kr_set(key, serialised):
                out[key] = _SENTINEL
    return out


def invalidate_cache(key: str | None = None):
    """Clear cached keychain values (e.g. after update)."""
    if key:
        _cache.pop(key, None)
    else:
        _cache.clear()
