"""
Unified AI client — tries Anthropic (Claude) first, falls back to OpenAI
when Claude is rate-limited or over the daily usage cap.

Usage:
    client = AIClient(anthropic_key="sk-ant-…", openai_key="sk-…")
    resp = await client.messages.create(model="claude-sonnet-4-6", max_tokens=1800, messages=[…])
    text = resp.content[0].text          # same interface whether Claude or OpenAI answered
"""

import logging
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)

# Claude model → OpenAI equivalent (normal mode)
_MODEL_MAP: dict[str, str] = {
    "claude-haiku-4-5-20251001": "gpt-4o-mini",
    "claude-sonnet-4-6":         "gpt-4o",
    "claude-opus-4-7":           "gpt-4o",
}

# Budget mode: all calls use the cheapest model on each provider
_BUDGET_ANTHROPIC = "claude-haiku-4-5-20251001"
_BUDGET_OPENAI    = "gpt-4o-mini"

# Anthropic HTTP status codes that trigger OpenAI fallback.
# 429 = rate limit, 529 = overloaded, 401 = auth error (bad/expired key),
# 500/503 = server error — fall back rather than surfacing internal errors.
_FALLBACK_STATUSES = {401, 429, 500, 503, 529}

_BILLING_KEYWORDS = ("credit balance", "billing", "upgrade", "purchase credits")


def _is_billing_error(e: "anthropic.APIStatusError") -> bool:
    """Return True for 400 errors caused by exhausted Anthropic credits."""
    if e.status_code != 400:
        return False
    msg = str(e).lower()
    return any(kw in msg for kw in _BILLING_KEYWORDS)


class _OpenAIContent:
    """Mimic anthropic.types.ContentBlock so callers can use .content[0].text."""
    __slots__ = ("text", "type")

    def __init__(self, text: str):
        self.text = text
        self.type = "text"


class _OpenAIResponse:
    """Wrap an OpenAI ChatCompletion to look like an Anthropic Message."""

    def __init__(self, oai_resp):
        text = (oai_resp.choices[0].message.content or "") if oai_resp.choices else ""
        self.content = [_OpenAIContent(text)]
        self.model = oai_resp.model
        self.provider = "openai"


class _OpenAIStream:
    """Async context manager wrapping OpenAI streaming to match Anthropic's interface."""

    def __init__(self, client, model, max_tokens, messages, kwargs):
        self._client = client
        self._model = model
        self._max_tokens = max_tokens
        self._messages = messages
        self._kwargs = kwargs
        self._response = None

    async def __aenter__(self):
        oai_messages = list(self._messages)
        system = self._kwargs.get("system")
        if system:
            oai_messages = [{"role": "system", "content": system}] + oai_messages
        self._response = await self._client.chat.completions.create(
            model=self._model,
            max_tokens=self._max_tokens,
            messages=oai_messages,
            stream=True,
            **{k: v for k, v in self._kwargs.items() if k not in ("system",)},
        )
        return self

    async def __aexit__(self, *_):
        pass

    async def _gen(self):
        async for chunk in self._response:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield delta

    @property
    def text_stream(self):
        return self._gen()


class _AnthropicStreamWithFallback:
    """Enters Anthropic streaming; on quota errors falls back to _OpenAIStream."""

    def __init__(self, ant_client, oai_client, model, oai_model,
                 max_tokens, messages, kwargs):
        self._ant = ant_client
        self._oai = oai_client
        self._model = model
        self._oai_model = oai_model
        self._max_tokens = max_tokens
        self._messages = messages
        self._kwargs = kwargs
        self._ctx = None

    async def __aenter__(self):
        try:
            self._ctx = self._ant.messages.stream(
                model=self._model,
                max_tokens=self._max_tokens,
                messages=self._messages,
                **self._kwargs,
            )
            return await self._ctx.__aenter__()
        except (anthropic.RateLimitError,
                anthropic.APIConnectionError, anthropic.APITimeoutError) as e:
            logger.warning(f"[ai] Claude stream error — falling back to OpenAI ({e})")
        except anthropic.APIStatusError as e:
            if e.status_code in _FALLBACK_STATUSES or _is_billing_error(e):
                logger.warning(f"[ai] Claude HTTP {e.status_code} — falling back to OpenAI")
            else:
                raise

        if not self._oai:
            raise RuntimeError("No AI provider available after Claude quota error.")
        self._ctx = _OpenAIStream(self._oai, self._oai_model, self._max_tokens,
                                  self._messages, self._kwargs)
        return await self._ctx.__aenter__()

    async def __aexit__(self, *args):
        if self._ctx:
            await self._ctx.__aexit__(*args)


class _Messages:
    """Nested namespace so callers can do `client.messages.create(…)`."""

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
    Drop-in replacement for anthropic.AsyncAnthropic with OpenAI fallback.

    The .messages.create() interface is identical to Anthropic's SDK.
    The response object always has .content[0].text regardless of which
    provider answered.
    """

    def __init__(self, anthropic_key: str = "", openai_key: str = "",
                 budget_mode: bool = False):
        self._anthropic_key = anthropic_key
        self._openai_key = openai_key
        self._budget_mode = budget_mode
        self._anthropic: Optional[anthropic.AsyncAnthropic] = None
        self._openai = None
        self._build_clients()
        self.messages = _Messages(self)

    # ── Setup ─────────────────────────────────────────────────────────────────

    def _build_clients(self):
        if self._anthropic_key:
            self._anthropic = anthropic.AsyncAnthropic(api_key=self._anthropic_key)
        else:
            self._anthropic = None

        if self._openai_key:
            try:
                from openai import AsyncOpenAI
                self._openai = AsyncOpenAI(api_key=self._openai_key)
            except ImportError:
                logger.warning("[ai] openai package not installed — OpenAI fallback unavailable")
                self._openai = None
        else:
            self._openai = None

    def update_keys(self, anthropic_key: Optional[str] = None,
                    openai_key: Optional[str] = None,
                    budget_mode: Optional[bool] = None):
        """Hot-reload credentials and settings without restarting."""
        changed = False
        if anthropic_key is not None and anthropic_key != self._anthropic_key:
            self._anthropic_key = anthropic_key
            changed = True
        if openai_key is not None and openai_key != self._openai_key:
            self._openai_key = openai_key
            changed = True
        if budget_mode is not None and budget_mode != self._budget_mode:
            self._budget_mode = budget_mode
            changed = True
        if changed:
            self._build_clients()

    # ── Core call ─────────────────────────────────────────────────────────────

    async def _create(self, *, model: str, max_tokens: int, messages: list, **kwargs):
        # Apply budget mode — downgrade expensive models to cheapest available
        if self._budget_mode:
            model = _BUDGET_ANTHROPIC

        # 1. Try Anthropic
        if self._anthropic:
            try:
                resp = await self._anthropic.messages.create(
                    model=model, max_tokens=max_tokens, messages=messages, **kwargs
                )
                return resp
            except anthropic.RateLimitError as e:
                logger.warning(f"[ai] Claude rate-limited — falling back to OpenAI ({e})")
            # anthropic.OverloadedError (529) is handled below via APIStatusError
            except anthropic.APIStatusError as e:
                if e.status_code in _FALLBACK_STATUSES or _is_billing_error(e):
                    logger.warning(
                        f"[ai] Claude HTTP {e.status_code} — falling back to OpenAI"
                    )
                else:
                    raise

        # 2. Fallback to OpenAI
        if self._openai:
            oai_model = _BUDGET_OPENAI if self._budget_mode else _MODEL_MAP.get(model, "gpt-4o-mini")
            oai_messages = list(messages)
            if kwargs.get("system"):
                oai_messages = [{"role": "system", "content": kwargs["system"]}] + oai_messages
            logger.info(f"[ai] Using OpenAI {oai_model} (mapped from {model})")
            resp = await self._openai.chat.completions.create(
                model=oai_model,
                max_tokens=max_tokens,
                messages=oai_messages,
                **{k: v for k, v in kwargs.items() if k not in ("system",)},
            )
            return _OpenAIResponse(resp)

        raise RuntimeError(
            "No AI provider is available. "
            "Add an Anthropic or OpenAI API key in Settings → App Settings."
        )

    def _stream(self, *, model: str, max_tokens: int, messages: list, **kwargs):
        """Return an async context manager with a .text_stream async generator."""
        if self._budget_mode:
            model = _BUDGET_ANTHROPIC

        oai_model = _BUDGET_OPENAI if self._budget_mode else _MODEL_MAP.get(model, "gpt-4o-mini")

        if self._anthropic:
            return _AnthropicStreamWithFallback(
                self._anthropic, self._openai, model, oai_model, max_tokens, messages, kwargs
            )

        if self._openai:
            return _OpenAIStream(self._openai, oai_model, max_tokens, messages, kwargs)

        raise RuntimeError(
            "No AI provider is available. "
            "Add an Anthropic or OpenAI API key in Settings → App Settings."
        )
