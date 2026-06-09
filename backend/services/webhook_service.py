"""Fire-and-forget outbound webhooks for Zapier / Make / n8n / custom automation."""

import asyncio
import time
from datetime import datetime, timezone

_THROTTLE_LAST: dict[str, float] = {}
_THROTTLE_GAP = 5.0  # seconds between same-event fires (only for new_email)


async def fire_webhook(event: str, payload: dict, app) -> None:
    """POST JSON payload to all configured webhook URLs for the given event.

    Throttled for 'new_email' to max 1 per 5s. Fire-and-forget (never raises).
    """
    try:
        from routers.config import load_app_config
        cfg = load_app_config()
        urls: list[str] = cfg.get("webhook_urls") or []
        events: list[str] = cfg.get("webhook_events") or []
        if not urls or (events and event not in events):
            return

        # Throttle new_email events
        if event == "new_email":
            now = time.monotonic()
            last = _THROTTLE_LAST.get(event, 0.0)
            if now - last < _THROTTLE_GAP:
                return
            _THROTTLE_LAST[event] = now

        envelope = {
            "event": event,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": payload,
        }

        import httpx
        for url in urls[:3]:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(url, json=envelope)
            except Exception as e:
                print(f"[webhook] {event} -> {url}: {e}")
    except Exception as e:
        print(f"[webhook] error: {e}")
