"""Extract unsubscribe URLs from email content."""

from __future__ import annotations

import re
from typing import Optional

_UNSUB_PATTERNS = [
    r'href=["\']([^"\']*(?:unsubscribe|optout|opt[-_]out|remove[-_]me|email[-_]pref)[^"\']*)["\']',
    r'href=["\']([^"\']*\?[^"\']*(?:unsub|remove)[^"\']*)["\']',
]

_UNSUB_TEXT = re.compile(
    r'href=["\']([^"\']{10,300})["\'][^>]*>[^<]{0,80}(?:unsubscribe|opt.out|remove me)[^<]{0,20}</a',
    re.IGNORECASE,
)


def extract_unsubscribe_url(email) -> Optional[str]:
    """Return the first unsubscribe URL found in email HTML or plain body."""
    body = getattr(email, "body_html", None) or getattr(email, "body", None) or ""
    if not body:
        return None

    # Try structured patterns (href with keyword in URL)
    for pattern in _UNSUB_PATTERNS:
        for m in re.finditer(pattern, body, re.IGNORECASE):
            url = m.group(1).rstrip(".,;:)\"'")
            if url.startswith("http") and len(url) > 15:
                return url

    # Try link-text pattern (<a href="...">unsubscribe</a>)
    for m in _UNSUB_TEXT.finditer(body):
        url = m.group(1).rstrip(".,;:)\"'")
        if url.startswith("http") and len(url) > 15:
            return url

    return None
