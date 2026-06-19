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

# RFC 2369 List-Unsubscribe header — may appear in raw body when full headers
# are cached. Contains one or more <...> entries, each a mailto: or http(s): URI.
_LIST_UNSUB_HEADER = re.compile(
    r'^List-Unsubscribe:\s*(.+)$', re.IGNORECASE | re.MULTILINE
)
_ANGLE_URI = re.compile(r'<([^>]+)>')


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


def detect_unsubscribe(email) -> dict:
    """Resolve the best unsubscribe action for an email.

    Returns one of:
      {"method": "url", "url": "https://..."}       — open in browser
      {"method": "mailto", "address": "x@y", "subject": "...", "url": "mailto:..."}
      {"method": "none"}

    Prefers an http(s) link from the List-Unsubscribe header or body, since a
    one-click web flow is friendlier than sending mail. Falls back to a mailto:
    target the backend can send on the user's behalf.
    """
    headers = getattr(email, "headers", None) or ""
    body = getattr(email, "body_html", None) or getattr(email, "body", None) or ""

    http_target: Optional[str] = None
    mailto_target: Optional[str] = None

    # 1. List-Unsubscribe header (most reliable, RFC 2369). Header may live in a
    #    dedicated field or be embedded in cached raw body text.
    for source in (headers, body):
        if not source:
            continue
        for hm in _LIST_UNSUB_HEADER.finditer(source):
            for uri in _ANGLE_URI.findall(hm.group(1)):
                uri = uri.strip()
                if uri.lower().startswith("http") and not http_target:
                    http_target = uri
                elif uri.lower().startswith("mailto:") and not mailto_target:
                    mailto_target = uri
        if http_target or mailto_target:
            break

    # 2. Fall back to scanning body links for an unsubscribe URL.
    if not http_target:
        http_target = extract_unsubscribe_url(email)

    if http_target:
        return {"method": "url", "url": http_target}

    if mailto_target:
        addr, subject = _parse_mailto(mailto_target)
        if addr:
            return {"method": "mailto", "address": addr,
                    "subject": subject or "unsubscribe", "url": mailto_target}

    return {"method": "none"}


def _parse_mailto(mailto: str) -> tuple[Optional[str], Optional[str]]:
    """Split a mailto: URI into (address, subject)."""
    rest = mailto[len("mailto:"):]
    addr, _, query = rest.partition("?")
    addr = addr.strip()
    subject = None
    for part in query.split("&"):
        key, _, val = part.partition("=")
        if key.lower() == "subject":
            from urllib.parse import unquote
            subject = unquote(val)
    return (addr or None, subject)
