import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api", tags=["calendar"])

_cache_store: dict[int, dict] = {}
CACHE_TTL = 900


def _window(days: int) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = (start + timedelta(days=days)).replace(hour=23, minute=59, second=59)
    return start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")


def _pick_account(cache):
    for acc in cache.list_accounts():
        if getattr(acc, "access_token", None):
            return acc
    return None


async def _fetch_m365(token: str, days: int) -> list[dict]:
    start, end = _window(days)
    async with httpx.AsyncClient(timeout=20) as http:
        r = await http.get(
            "https://graph.microsoft.com/v1.0/me/calendarView",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "startDateTime": start,
                "endDateTime": end,
                "$select": "subject,start,end,organizer,responseStatus,isOnlineMeeting,onlineMeeting,location,attendees,bodyPreview",
                "$orderby": "start/dateTime",
                "$top": 50,
            },
        )
        r.raise_for_status()
        events = r.json().get("value", [])
    return [
        {
            "id": e.get("id", ""),
            "title": e.get("subject", "(No title)"),
            "start": e.get("start", {}).get("dateTime", ""),
            "end": e.get("end", {}).get("dateTime", ""),
            "date": e.get("start", {}).get("dateTime", "")[:10],
            "location": e.get("location", {}).get("displayName", "") or "",
            "organizer": e.get("organizer", {}).get("emailAddress", {}).get("name", ""),
            "is_online": e.get("isOnlineMeeting", False),
            "join_url": (e.get("onlineMeeting") or {}).get("joinUrl", ""),
            "attendee_count": len(e.get("attendees", [])),
            "response": e.get("responseStatus", {}).get("response", ""),
        }
        for e in events
    ]


async def _fetch_google(token: str, days: int) -> list[dict]:
    start, end = _window(days)
    async with httpx.AsyncClient(timeout=20) as http:
        r = await http.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "timeMin": start,
                "timeMax": end,
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": 50,
                "fields": "items(id,summary,start,end,organizer,attendees,hangoutLink,conferenceData,location,status)",
            },
        )
        r.raise_for_status()
        items = r.json().get("items", [])
    return [
        {
            "id": i.get("id", ""),
            "title": i.get("summary", "(No title)"),
            "start": i.get("start", {}).get("dateTime", i.get("start", {}).get("date", "")),
            "end": i.get("end", {}).get("dateTime", i.get("end", {}).get("date", "")),
            "date": (i.get("start", {}).get("dateTime", "") or i.get("start", {}).get("date", ""))[:10],
            "location": i.get("location", "") or "",
            "organizer": i.get("organizer", {}).get("displayName", "") or i.get("organizer", {}).get("email", ""),
            "is_online": bool(i.get("hangoutLink") or i.get("conferenceData")),
            "join_url": i.get("hangoutLink", ""),
            "attendee_count": len(i.get("attendees", [])),
            "response": next((a.get("responseStatus", "") for a in i.get("attendees", []) if a.get("self")), ""),
        }
        for i in items
    ]


def _resolve_token(acc) -> str:
    """Return the real access token, resolving keychain sentinel if needed."""
    from services.email_extras import _kr_get_oauth_bundle
    token = acc.access_token or ""
    if token == "__keychain__":
        bundle = _kr_get_oauth_bundle(acc.id)
        token = bundle.get("access_token", "") or ""
    return token


def _detect_no_oauth(cache) -> dict | None:
    """If the user has IMAP-only OAuth accounts, return a helpful reason dict."""
    for acc in cache.list_accounts():
        p = str(getattr(acc, "provider", "") or "").lower()
        if "gmail" in p or "google" in p:
            token = _resolve_token(acc)
            if not token:
                return {"events": [], "provider": "none", "days": 7, "reason": "gmail_imap"}
        elif "yahoo" in p or "outlook" in p or "hotmail" in p:
            token = _resolve_token(acc)
            if not token:
                return {"events": [], "provider": "none", "days": 7, "reason": "imap_only"}
    return None


async def _load(cache, days: int, force: bool = False) -> dict:
    acc = _pick_account(cache)
    if not acc:
        hint = _detect_no_oauth(cache)
        return hint or {"events": [], "provider": "none", "days": days}

    cached = _cache_store.get(acc.id)
    if not force and cached and (time.time() - cached["at"]) < CACHE_TTL and cached["days"] == days:
        return cached["data"]

    is_google = acc.provider in ("gmail", "google", "gmail_oauth")
    fetch = _fetch_google if is_google else _fetch_m365
    provider = "google" if is_google else "microsoft"
    token = _resolve_token(acc)
    if not token:
        return {"events": [], "provider": "none", "days": days}
    try:
        events = await fetch(token, days)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            new_token = cache.refresh_oauth_token(acc.id)
            if new_token:
                events = await fetch(new_token, days)
            else:
                return {"events": [], "provider": "none", "days": days}
        else:
            return {"events": [], "provider": "none", "days": days}

    events.sort(key=lambda ev: ev["start"])
    data = {"events": events, "provider": provider, "days": days}
    _cache_store[acc.id] = {"at": time.time(), "days": days, "data": data}
    return data


async def get_today_events(cache) -> list[dict]:
    try:
        data = await _load(cache, 1)
        return data.get("events", [])
    except Exception:
        return []


@router.get("/calendar")
async def calendar(request: Request, days: int = 7, force: bool = False):
    cache = getattr(request.app.state, "cache", None)
    if cache is None:
        return {"events": [], "provider": "none", "days": days}
    try:
        return await _load(cache, days, force=force)
    except Exception:
        return {"events": [], "provider": "none", "days": days}
