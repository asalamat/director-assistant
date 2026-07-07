"""
Unified AI client — supports multiple providers in configurable priority order.

Supported providers:
  anthropic          — Claude (primary by default)
  openai             — GPT-4o / GPT-4o-mini
  groq               — Llama / Mixtral / Gemma (OpenAI-compatible API)
  gemini             — Google Gemini
  ollama             — Local models via Ollama (OpenAI-compatible)
  openai-compatible  — Any OpenAI-compatible endpoint (custom base URL)

The client tries each enabled provider in priority order, falling back to the
next on rate-limit / quota / auth errors.

Usage:
    client = AIClient(providers=[
        {"type": "anthropic", "key": "sk-ant-…",  "enabled": True, "priority": 1},
        {"type": "openai",    "key": "sk-…",       "enabled": True, "priority": 2},
        {"type": "groq",      "key": "gsk_…",      "enabled": True, "priority": 3},
    ])
    resp = await client.messages.create(model="claude-sonnet-4-6", max_tokens=1800, messages=[…])
    text = resp.content[0].text
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

import anthropic

logger = logging.getLogger(__name__)

# ── Model mappings ────────────────────────────────────────────────────────────

# Claude model → OpenAI/Groq equivalent
_TO_OPENAI: dict[str, str] = {
    "claude-haiku-4-5-20251001": "gpt-4o-mini",
    "claude-sonnet-4-6":         "gpt-4o",
    "claude-opus-4-7":           "gpt-4o",
    "claude-opus-4-8":           "gpt-4o",
}

# Claude model → Groq equivalent (fast, cheap)
_TO_GROQ: dict[str, str] = {
    "claude-haiku-4-5-20251001": "llama-3.1-8b-instant",
    "claude-sonnet-4-6":         "llama-3.3-70b-versatile",
    "claude-opus-4-7":           "llama-3.3-70b-versatile",
}

# Claude model → Gemini equivalent
_TO_GEMINI: dict[str, str] = {
    "claude-haiku-4-5-20251001": "gemini-2.0-flash-lite",
    "claude-sonnet-4-6":         "gemini-2.0-flash",
    "claude-opus-4-7":           "gemini-1.5-pro",
}

_TO_KIMI: dict[str, str] = {
    "claude-haiku-4-5-20251001": "moonshot-v1-8k",
    "claude-sonnet-4-6":         "moonshot-v1-32k",
    "claude-opus-4-7":           "moonshot-v1-128k",
}

_BUDGET_MODEL = {
    "anthropic": "claude-haiku-4-5-20251001",
    "openai":    "gpt-4o-mini",
    "groq":      "llama-3.1-8b-instant",
    "gemini":    "gemini-1.5-flash",
    "ollama":    "llama3.2",
    "kimi":      "moonshot-v1-8k",
    "openai-compatible": "gpt-4o-mini",
}

# Standard model for all non-budget calls; budget mode overrides to cheap equivalents
DEFAULT_MODEL = "claude-sonnet-4-6"

# HTTP status codes that trigger fallback to next provider
_FALLBACK_STATUSES = {401, 429, 500, 503, 529}
_BILLING_KEYWORDS = ("credit balance", "billing", "upgrade", "purchase credits")


# ── Provider config ───────────────────────────────────────────────────────────

@dataclass
class ProviderConfig:
    type: str               # anthropic | openai | groq | gemini | ollama | openai-compatible
    key: str = ""
    enabled: bool = True
    priority: int = 0       # lower = higher priority (1 = primary)
    base_url: str = ""      # for openai-compatible / ollama
    model_override: str = "" # optional: force a specific model for this provider
    label: str = ""         # display name

    @classmethod
    def from_dict(cls, d: dict) -> "ProviderConfig":
        return cls(
            type=d.get("type", "openai"),
            key=d.get("key", ""),
            enabled=d.get("enabled", True),
            priority=d.get("priority", 99),
            base_url=d.get("base_url", ""),
            model_override=d.get("model_override", ""),
            label=d.get("label", ""),
        )

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "key": self.key[:8] + "…" if len(self.key) > 8 else self.key,
            "enabled": self.enabled,
            "priority": self.priority,
            "base_url": self.base_url,
            "model_override": self.model_override,
            "label": self.label or self.type,
        }


# ── Response wrappers ─────────────────────────────────────────────────────────

class _TextContent:
    __slots__ = ("text", "type")
    def __init__(self, text: str, provider: str = ""):
        self.text = text
        self.type = "text"


class _WrappedResponse:
    def __init__(self, text: str, model: str = "", provider: str = ""):
        self.content = [_TextContent(text, provider)]
        self.model = model
        self.provider = provider


# ── Per-provider call logic ───────────────────────────────────────────────────

def _map_model(original: str, provider_type: str) -> str:
    if provider_type == "anthropic":
        return original
    if provider_type in ("openai", "openai-compatible"):
        return _TO_OPENAI.get(original, "gpt-4o-mini")
    if provider_type == "groq":
        return _TO_GROQ.get(original, "llama-3.1-8b-instant")
    if provider_type == "gemini":
        return _TO_GEMINI.get(original, "gemini-1.5-flash")
    if provider_type == "ollama":
        return _TO_GROQ.get(original, "llama3.2")
    if provider_type == "kimi":
        return _TO_KIMI.get(original, "moonshot-v1-32k")
    return original


async def _call_anthropic(client, model: str, max_tokens: int, messages: list, kwargs: dict):
    resp = await client.messages.create(
        model=model, max_tokens=max_tokens, messages=messages, **kwargs
    )
    return resp


async def _call_openai_compat(client, model: str, max_tokens: int, messages: list, kwargs: dict):
    oai_messages = list(messages)
    system = kwargs.get("system")
    if system:
        oai_messages = [{"role": "system", "content": system}] + oai_messages
    resp = await client.chat.completions.create(
        model=model, max_tokens=max_tokens, messages=oai_messages,
        **{k: v for k, v in kwargs.items() if k not in ("system",)},
    )
    text = (resp.choices[0].message.content or "") if resp.choices else ""
    return _WrappedResponse(text, model, "openai-compat")


async def _call_gemini(key: str, model: str, max_tokens: int, messages: list, kwargs: dict):
    # Build prompt from messages
    system_prompt = kwargs.get("system", "")
    parts = []
    if system_prompt:
        parts.append(system_prompt + "\n\n")
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            content = " ".join(c.get("text", "") for c in content if isinstance(c, dict))
        parts.append(f"{'User' if role == 'user' else 'Assistant'}: {content}\n")
    prompt = "".join(parts)

    # Try new google-genai SDK first (recommended)
    try:
        from google import genai as google_genai
        client = google_genai.Client(api_key=key)
        resp = await client.aio.models.generate_content(
            model=model,
            contents=prompt,
        )
        text = resp.text if hasattr(resp, "text") else ""
        return _WrappedResponse(text, model, "gemini")
    except ImportError:
        pass  # fall through to legacy SDK

    # Fallback: legacy google-generativeai SDK
    try:
        import google.generativeai as genai_legacy
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            genai_legacy.configure(api_key=key)
            gm = genai_legacy.GenerativeModel(model)
            resp = await gm.generate_content_async(
                prompt,
                generation_config=genai_legacy.types.GenerationConfig(max_output_tokens=max_tokens),
            )
        text = resp.text if hasattr(resp, "text") else ""
        return _WrappedResponse(text, model, "gemini")
    except ImportError:
        raise RuntimeError(
            "Gemini requires google-genai. Run: pip install google-genai"
        )


def _is_fallback_error(exc: Exception) -> bool:
    """True if this error should trigger fallback to next provider."""
    if isinstance(exc, (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APITimeoutError)):
        return True
    if isinstance(exc, anthropic.APIStatusError):
        if exc.status_code in _FALLBACK_STATUSES:
            return True
        msg = str(exc).lower()
        if any(kw in msg for kw in _BILLING_KEYWORDS):
            return True
    # OpenAI / openai-compat errors
    try:
        from openai import RateLimitError, AuthenticationError, APIStatusError, APIConnectionError
        if isinstance(exc, (RateLimitError, AuthenticationError, APIConnectionError)):
            return True
        if isinstance(exc, APIStatusError) and exc.status_code in _FALLBACK_STATUSES:
            return True
    except ImportError:
        pass
    if isinstance(exc, RuntimeError) and "rate" in str(exc).lower():
        return True
    return False


# ── Stream wrappers ───────────────────────────────────────────────────────────

class _OAIStream:
    def __init__(self, client, model, max_tokens, messages, kwargs):
        self._c = client; self._m = model; self._mt = max_tokens
        self._msgs = messages; self._kw = kwargs; self._r = None

    async def __aenter__(self):
        oai_msgs = list(self._msgs)
        system = self._kw.get("system")
        if system:
            oai_msgs = [{"role": "system", "content": system}] + oai_msgs
        self._r = await self._c.chat.completions.create(
            model=self._m, max_tokens=self._mt, messages=oai_msgs, stream=True,
            **{k: v for k, v in self._kw.items() if k not in ("system",)},
        )
        return self

    async def __aexit__(self, *_): pass

    async def _gen(self):
        async for chunk in self._r:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield delta

    @property
    def text_stream(self): return self._gen()


class _AnthropicStream:
    def __init__(self, ant, fallback_ctx, model, max_tokens, messages, kwargs):
        self._ant = ant; self._fb = fallback_ctx
        self._m = model; self._mt = max_tokens; self._msgs = messages; self._kw = kwargs
        self._ctx = None

    async def __aenter__(self):
        try:
            self._ctx = self._ant.messages.stream(
                model=self._m, max_tokens=self._mt, messages=self._msgs, **self._kw
            )
            return await self._ctx.__aenter__()
        except Exception as e:
            if _is_fallback_error(e) and self._fb:
                logger.warning(f"[ai] Claude stream error ({e}) — falling back")
                self._ctx = self._fb
                return await self._ctx.__aenter__()
            raise

    async def __aexit__(self, *args):
        if self._ctx:
            await self._ctx.__aexit__(*args)


# ── Main client ───────────────────────────────────────────────────────────────

class _GeminiPseudoStream:
    """Wraps the non-streaming Gemini API call as an async streaming interface.
    Yields the full response as a single chunk so callers that expect .text_stream work."""

    def __init__(self, key: str, model: str, max_tokens: int, messages: list, kwargs: dict):
        self._key = key
        self._model = model
        self._max_tokens = max_tokens
        self._messages = messages
        self._kwargs = kwargs
        self._text: str = ""

    async def __aenter__(self):
        # Call non-streaming Gemini and store result
        resp = await _call_gemini(self._key, self._model, self._max_tokens,
                                  self._messages, self._kwargs)
        self._text = resp.content[0].text if resp.content else ""
        return self

    async def __aexit__(self, *_): pass

    async def _gen(self):
        # Yield in small chunks for a smoother UX
        chunk_size = 20
        for i in range(0, len(self._text), chunk_size):
            yield self._text[i:i + chunk_size]

    @property
    def text_stream(self):
        return self._gen()


class _Messages:
    def __init__(self, parent: "AIClient"):
        self._p = parent

    async def create(self, *, model: str, max_tokens: int, messages: list, **kwargs):
        return await self._p._create(model=model, max_tokens=max_tokens,
                                     messages=messages, **kwargs)

    def stream(self, *, model: str, max_tokens: int, messages: list, **kwargs):
        return self._p._stream(model=model, max_tokens=max_tokens,
                               messages=messages, **kwargs)


class AIClient:
    """
    Multi-provider AI client with configurable priority order.
    Tries each enabled provider in order; falls back on quota/auth errors.
    """

    def __init__(self,
                 anthropic_key: str = "",
                 openai_key: str = "",
                 budget_mode: bool = False,
                 providers: list[dict] | None = None):
        self._budget_mode = budget_mode
        self._built: dict[str, Any] = {}  # provider instance cache

        if providers:
            # New multi-provider mode
            self._providers = sorted(
                [ProviderConfig.from_dict(p) for p in providers if p.get("enabled", True)],
                key=lambda p: p.priority
            )
        else:
            # Legacy two-key mode — create default provider list
            self._providers = []
            if anthropic_key:
                self._providers.append(ProviderConfig(
                    type="anthropic", key=anthropic_key, enabled=True, priority=1,
                ))
            if openai_key:
                self._providers.append(ProviderConfig(
                    type="openai", key=openai_key, enabled=True, priority=2,
                ))

        self._build_clients()
        self.messages = _Messages(self)

    def _build_clients(self):
        self._built.clear()
        for p in self._providers:
            if not p.enabled:
                continue
            try:
                if p.type == "anthropic" and p.key:
                    self._built[id(p)] = anthropic.AsyncAnthropic(api_key=p.key)
                elif p.type in ("openai", "groq", "ollama", "kimi", "openai-compatible"):
                    # Ollama doesn't require a real key; all others do
                    effective_key = p.key or ("ollama" if p.type == "ollama" else "")
                    if not effective_key and p.type != "ollama":
                        logger.debug(f"[ai] skipping {p.type} provider — no API key")
                        continue
                    from openai import AsyncOpenAI
                    base = p.base_url or (
                        "https://api.groq.com/openai/v1"    if p.type == "groq" else
                        "http://localhost:11434/v1"          if p.type == "ollama" else
                        "https://api.moonshot.cn/v1"         if p.type == "kimi" else
                        None
                    )
                    build_kwargs: dict = {"api_key": effective_key}
                    if base:
                        build_kwargs["base_url"] = base
                    self._built[id(p)] = AsyncOpenAI(**build_kwargs)
                elif p.type == "gemini":
                    self._built[id(p)] = p.key  # pass key at call time
            except Exception as e:
                logger.warning(f"[ai] Failed to init provider {p.type}: {e}")

    def update_providers(self, providers: list[dict] | None = None,
                         anthropic_key: str | None = None,
                         openai_key: str | None = None,
                         budget_mode: bool | None = None):
        if budget_mode is not None:
            self._budget_mode = budget_mode
        if providers is not None:
            self._providers = sorted(
                [ProviderConfig.from_dict(p) for p in providers if p.get("enabled", True)],
                key=lambda p: p.priority
            )
        elif anthropic_key is not None or openai_key is not None:
            # Legacy hot-reload
            for p in self._providers:
                if p.type == "anthropic" and anthropic_key is not None:
                    p.key = anthropic_key
                if p.type == "openai" and openai_key is not None:
                    p.key = openai_key
        self._build_clients()

    # Keep old API surface for code that still calls update_keys
    def update_keys(self, anthropic_key: str | None = None,
                    openai_key: str | None = None,
                    budget_mode: bool | None = None):
        self.update_providers(anthropic_key=anthropic_key, openai_key=openai_key,
                              budget_mode=budget_mode)

    def list_providers(self) -> list[dict]:
        return [p.to_dict() for p in self._providers]

    @property
    def primary_provider(self) -> str:
        for p in self._providers:
            if p.enabled:
                return p.type
        return "none"

    async def _create(self, *, model: str, max_tokens: int, messages: list, **kwargs):
        if self._budget_mode:
            # Use budget model for the first enabled provider
            for p in self._providers:
                if p.enabled:
                    model = _BUDGET_MODEL.get(p.type, model)
                    break

        errors = []
        for p in self._providers:
            if not p.enabled:
                continue
            client = self._built.get(id(p))
            mapped_model = p.model_override or _map_model(model, p.type)
            if self._budget_mode:
                mapped_model = _BUDGET_MODEL.get(p.type, mapped_model)

            try:
                if p.type == "anthropic" and client:
                    resp = await _call_anthropic(client, mapped_model, max_tokens, messages, kwargs)
                    return resp
                elif p.type in ("openai", "groq", "ollama", "kimi", "openai-compatible") and client:
                    resp = await _call_openai_compat(client, mapped_model, max_tokens, messages, kwargs)
                    return resp
                elif p.type == "gemini" and p.key:
                    resp = await _call_gemini(p.key, mapped_model, max_tokens, messages, kwargs)
                    return resp
            except Exception as e:
                if _is_fallback_error(e):
                    logger.warning(f"[ai] {p.type} failed ({e}) — trying next provider")
                    errors.append(f"{p.type}: {e}")
                    continue
                raise

        if errors:
            raise RuntimeError(
                f"All AI providers failed: {'; '.join(errors)}"
            )
        raise RuntimeError(
            "No AI provider configured. Add a provider in Settings → App Settings."
        )

    def _stream(self, *, model: str, max_tokens: int, messages: list, **kwargs):
        if self._budget_mode:
            for p in self._providers:
                if p.enabled:
                    model = _BUDGET_MODEL.get(p.type, model)
                    break

        # Walk providers in priority order — prefer native streaming types first,
        # but build a Gemini pseudo-stream if that's the only enabled provider.
        primary = None
        fallback = None
        gemini_fallback = None  # used if no streaming-capable primary found

        for p in self._providers:
            if not p.enabled:
                continue
            client = self._built.get(id(p))
            mapped = p.model_override or _map_model(model, p.type)
            if self._budget_mode:
                mapped = _BUDGET_MODEL.get(p.type, mapped)

            # Native streaming: anthropic + OpenAI-compatible
            is_streaming_capable = p.type in (
                "anthropic", "openai", "groq", "ollama", "kimi", "openai-compatible"
            ) and client

            if is_streaming_capable:
                if primary is None:
                    primary = (p, client, mapped)
                elif fallback is None:
                    fallback = (p, client, mapped)
                    break
            elif p.type == "gemini" and p.key and gemini_fallback is None:
                # Keep as last-resort pseudo-stream
                gemini_fallback = (p, mapped)

        if primary is None and gemini_fallback is None:
            raise RuntimeError(
                "No streaming-capable provider configured. "
                "Enable Anthropic, OpenAI, Groq, Ollama, or Kimi in Settings → AI Providers."
            )

        # Use Gemini pseudo-stream if no native streaming provider is available
        if primary is None and gemini_fallback:
            gp, gm = gemini_fallback
            return _GeminiPseudoStream(gp.key, gm, max_tokens, messages, kwargs)

        p, client, mapped = primary
        fb_ctx = None
        if fallback:
            fp, fc, fm = fallback
            if fp.type in ("openai", "groq", "ollama", "kimi", "openai-compatible") and fc:
                fb_ctx = _OAIStream(fc, fm, max_tokens, messages, kwargs)

        if p.type == "anthropic" and client:
            return _AnthropicStream(client, fb_ctx, mapped, max_tokens, messages, kwargs)
        elif p.type in ("openai", "groq", "ollama", "kimi", "openai-compatible") and client:
            return _OAIStream(client, mapped, max_tokens, messages, kwargs)
        raise RuntimeError("No streaming-capable provider configured.")
