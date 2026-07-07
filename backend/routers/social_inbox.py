"""Unified Social Inbox — DMs, comments, and mentions from Instagram + LinkedIn.

Fetches conversations/comments via the platform Graph/REST APIs, stores them in a
local `social_inbox` table, and exposes list/reply/read/sync endpoints. Replies are
posted back to the originating platform.
"""

import html
import re
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request

from routers.instagram import GRAPH_BASE, IG_GRAPH_BASE, _get_instagram_settings
from routers.social import _get_linkedin_settings

router = APIRouter(prefix="/api/social/inbox", tags=["social-inbox"])

MAX_REPLY_CHARS = 2200
VALID_PLATFORMS = ("instagram", "linkedin")
VALID_TYPES = ("dm", "comment", "mention")


def _ensure_tables(cache) -> None:
    with cache._conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS social_inbox (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL CHECK(platform IN ('instagram','linkedin')),
                type TEXT NOT NULL CHECK(type IN ('dm','comment','mention')),
                sender_name TEXT DEFAULT '',
                sender_id TEXT DEFAULT '',
                content TEXT DEFAULT '',
                media_url TEXT DEFAULT '',
                parent_id TEXT DEFAULT '',
                is_read INTEGER DEFAULT 0,
                replied_at TEXT,
                created_at TEXT NOT NULL,
                fetched_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_social_inbox_platform "
            "ON social_inbox(platform, is_read, created_at DESC)"
        )


def _strip_html(text: str) -> str:
    """Remove HTML tags and unescape entities from reply text."""
    no_tags = re.sub(r"<[^>]+>", "", text or "")
    return html.unescape(no_tags).strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _upsert_messages(cache, rows: list[dict]) -> int:
    """Insert messages, ignoring duplicates by id. Returns count of new rows."""
    if not rows:
        return 0
    inserted = 0
    with cache._conn() as conn:
        for r in rows:
            cur = conn.execute(
                """INSERT OR IGNORE INTO social_inbox
                   (id, platform, type, sender_name, sender_id, content,
                    media_url, parent_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    r["id"], r["platform"], r["type"], r.get("sender_name", ""),
                    r.get("sender_id", ""), r.get("content", ""),
                    r.get("media_url", ""), r.get("parent_id", ""),
                    r.get("created_at") or _now_iso(),
                ),
            )
            inserted += cur.rowcount
    return inserted


# ── Instagram fetch ─────────────────────────────────────────────────────────

async def _fetch_instagram(settings: dict) -> list[dict]:
    """Fetch Instagram DMs and comments on recent media. Returns inbox-row dicts."""
    token = (settings.get("access_token") or "").strip()
    ig_user_id = (settings.get("ig_user_id") or "").strip()
    if not token or not ig_user_id:
        raise ValueError("Instagram access token / user ID not configured — go to Settings → Instagram")

    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=30.0) as http:
        for base in (IG_GRAPH_BASE, GRAPH_BASE):
            host_failed = False

            # --- DMs via conversations ---
            try:
                conv = await http.get(
                    f"{base}/{ig_user_id}/conversations",
                    params={
                        "fields": "messages{message,from,created_time}",
                        "access_token": token,
                    },
                )
                if conv.status_code == 400 and base == IG_GRAPH_BASE:
                    host_failed = True
                elif conv.status_code < 400:
                    for c in (conv.json() or {}).get("data", []):
                        for m in (c.get("messages") or {}).get("data", []):
                            mid = m.get("id")
                            if not mid:
                                continue
                            frm = m.get("from") or {}
                            rows.append({
                                "id": f"ig_dm_{mid}",
                                "platform": "instagram",
                                "type": "dm",
                                "sender_name": frm.get("username") or frm.get("name") or "",
                                "sender_id": frm.get("id") or "",
                                "content": m.get("message") or "",
                                "parent_id": c.get("id") or "",
                                "created_at": m.get("created_time") or _now_iso(),
                            })
            except Exception:
                pass

            # --- Comments on recent media ---
            try:
                media = await http.get(
                    f"{base}/{ig_user_id}/media",
                    params={"fields": "id", "limit": 10, "access_token": token},
                )
                if media.status_code == 400 and base == IG_GRAPH_BASE:
                    host_failed = True
                elif media.status_code < 400:
                    for item in (media.json() or {}).get("data", []):
                        media_id = item.get("id")
                        if not media_id:
                            continue
                        cm = await http.get(
                            f"{base}/{media_id}/comments",
                            params={
                                "fields": "id,text,username,timestamp,from",
                                "access_token": token,
                            },
                        )
                        if cm.status_code >= 400:
                            continue
                        for c in (cm.json() or {}).get("data", []):
                            cid = c.get("id")
                            if not cid:
                                continue
                            frm = c.get("from") or {}
                            rows.append({
                                "id": f"ig_cm_{cid}",
                                "platform": "instagram",
                                "type": "comment",
                                "sender_name": c.get("username") or frm.get("username") or "",
                                "sender_id": frm.get("id") or "",
                                "content": c.get("text") or "",
                                "parent_id": media_id,
                                "created_at": c.get("timestamp") or _now_iso(),
                            })
            except Exception:
                pass

            # If the Instagram host returned host-mismatch errors, retry on graph.facebook.com
            if host_failed and base == IG_GRAPH_BASE:
                continue
            break

    return rows


async def _reply_instagram(settings: dict, msg: dict, text: str) -> dict:
    """Post a reply to an Instagram DM or comment. Returns {reply_id} or {error}."""
    token = (settings.get("access_token") or "").strip()
    if not token:
        return {"error": "Instagram access token not configured"}

    msg_type = msg["type"]
    # For comments: POST /{comment_id}/replies; for DMs: POST /{conversation}/messages
    target = msg["parent_id"] if msg_type == "dm" else _strip_id(msg["id"])
    if not target:
        return {"error": "Cannot determine reply target"}

    async with httpx.AsyncClient(timeout=30.0) as http:
        for base in (IG_GRAPH_BASE, GRAPH_BASE):
            if msg_type == "comment":
                r = await http.post(
                    f"{base}/{target}/replies",
                    data={"message": text, "access_token": token},
                )
            else:
                r = await http.post(
                    f"{base}/{target}/messages",
                    data={"message": text, "access_token": token},
                )
            if r.status_code == 400 and base == IG_GRAPH_BASE:
                continue
            if r.status_code >= 400:
                return {"error": f"Reply failed {r.status_code}: {r.text[:200]}"}
            return {"reply_id": (r.json() or {}).get("id", "")}
    return {"error": "Reply failed on all endpoints"}


def _strip_id(prefixed: str) -> str:
    """Strip our local id prefixes (ig_cm_, ig_dm_, ln_cm_) to recover the platform id."""
    for p in ("ig_cm_", "ig_dm_", "ln_cm_", "ln_mn_"):
        if prefixed.startswith(p):
            return prefixed[len(p):]
    return prefixed


# ── LinkedIn fetch ────────────────────────────────────────────────────────────

async def _fetch_linkedin(cache, settings: dict) -> list[dict]:
    """Fetch LinkedIn comments on recent posts. DMs require Partner API — skipped."""
    token = (settings.get("access_token") or "").strip()
    if not token:
        raise ValueError("LinkedIn access token not configured — go to Settings → LinkedIn")

    # Gather recent published post URNs from our own history
    with cache._conn() as conn:
        post_rows = conn.execute(
            "SELECT linkedin_post_id FROM linkedin_posts "
            "WHERE status='published' AND linkedin_post_id IS NOT NULL "
            "AND linkedin_post_id != '' ORDER BY published_at DESC LIMIT 20"
        ).fetchall()
    urns = [r["linkedin_post_id"] for r in post_rows if r["linkedin_post_id"]]
    if not urns:
        return []

    headers = {
        "Authorization": f"Bearer {token}",
        "LinkedIn-Version": "202410",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=30.0) as http:
        for urn in urns:
            try:
                r = await http.get(
                    f"https://api.linkedin.com/v2/socialActions/{urn}/comments",
                    headers=headers,
                )
                if r.status_code >= 400:
                    continue
                for c in (r.json() or {}).get("elements", []):
                    cid = c.get("$URN") or c.get("id") or ""
                    if not cid:
                        continue
                    actor = c.get("actor") or ""
                    text = ((c.get("message") or {}).get("text") or "")
                    created = c.get("created", {}).get("time")
                    created_iso = (
                        datetime.fromtimestamp(created / 1000, timezone.utc).isoformat()
                        if isinstance(created, (int, float)) else _now_iso()
                    )
                    rows.append({
                        "id": f"ln_cm_{cid}",
                        "platform": "linkedin",
                        "type": "comment",
                        "sender_name": actor.split(":")[-1] if actor else "",
                        "sender_id": actor,
                        "content": text,
                        "parent_id": urn,
                        "created_at": created_iso,
                    })
            except Exception:
                continue
    return rows


async def _reply_linkedin(settings: dict, msg: dict, text: str) -> dict:
    """Post a comment reply to a LinkedIn post/comment. Returns {reply_id} or {error}."""
    token = (settings.get("access_token") or "").strip()
    user_id = (settings.get("user_id") or "").strip()
    if not token:
        return {"error": "LinkedIn access token not configured"}

    # Resolve author URN
    from routers.social import _resolve_linkedin_author
    author, err = await _resolve_linkedin_author(token, user_id)
    if err:
        return {"error": err}

    parent_urn = msg["parent_id"]
    if not parent_urn:
        return {"error": "Cannot determine the post to comment on"}

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "LinkedIn-Version": "202410",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    payload = {"actor": author, "message": {"text": text}}
    async with httpx.AsyncClient(timeout=30.0) as http:
        r = await http.post(
            f"https://api.linkedin.com/v2/socialActions/{parent_urn}/comments",
            headers=headers, json=payload,
        )
    if r.status_code >= 400:
        return {"error": f"LinkedIn reply failed {r.status_code}: {r.text[:200]}"}
    return {"reply_id": (r.json() or {}).get("$URN") or (r.json() or {}).get("id", "")}


# ── Sync orchestration ────────────────────────────────────────────────────────

async def sync_platform(cache, platform: str) -> int:
    """Fetch + store messages for one platform. Returns count of new messages."""
    if platform == "instagram":
        settings = _get_instagram_settings()
        rows = await _fetch_instagram(settings)
    elif platform == "linkedin":
        settings = _get_linkedin_settings()
        rows = await _fetch_linkedin(cache, settings)
    else:
        raise ValueError(f"Unknown platform: {platform}")
    return _upsert_messages(cache, rows)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_inbox(request: Request, platform: str = "", type: str = "", unread: bool = False):
    cache = request.app.state.cache
    _ensure_tables(cache)

    clauses, params = [], []
    if platform:
        if platform not in VALID_PLATFORMS:
            return {"messages": [], "total": 0}
        clauses.append("platform = ?")
        params.append(platform)
    if type:
        if type not in VALID_TYPES:
            return {"messages": [], "total": 0}
        clauses.append("type = ?")
        params.append(type)
    if unread:
        clauses.append("is_read = 0")

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with cache._conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS c FROM social_inbox{where}", params
        ).fetchone()["c"]
        rows = conn.execute(
            f"SELECT * FROM social_inbox{where} ORDER BY created_at DESC LIMIT 200",
            params,
        ).fetchall()
    messages = [dict(r) for r in rows]
    return {"messages": messages, "total": total}


@router.get("/unread-count")
async def unread_count(request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT platform, COUNT(*) AS c FROM social_inbox "
            "WHERE is_read = 0 GROUP BY platform"
        ).fetchall()
    counts = {"instagram": 0, "linkedin": 0}
    for r in rows:
        if r["platform"] in counts:
            counts[r["platform"]] = r["c"]
    return counts


_PERMISSION_HINTS = {
    "instagram": (
        "Instagram comment/DM reading requires a Facebook Business app token with "
        "instagram_manage_comments + instagram_manage_messages scopes. "
        "Your current token is for posting only. "
        "Visit instagram.com/direct or check notifications at instagram.com/accounts/activity."
    ),
    "linkedin": (
        "LinkedIn comment reading requires Partner API access (Community Management API). "
        "Standard OAuth tokens cannot read comments on posts. "
        "View your LinkedIn notifications at linkedin.com/notifications."
    ),
}


@router.post("/sync")
async def sync_inbox(body: dict, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    platform = (body.get("platform") or "").strip()
    if platform not in VALID_PLATFORMS:
        return {"error": "platform must be 'instagram' or 'linkedin'", "fetched": 0}
    try:
        fetched = await sync_platform(cache, platform)
        hint = _PERMISSION_HINTS.get(platform, "") if fetched == 0 else ""
        return {"fetched": fetched, "hint": hint}
    except ValueError as e:
        return {"error": str(e), "fetched": 0, "hint": _PERMISSION_HINTS.get(platform, "")}
    except Exception as e:
        err = str(e)
        if "403" in err or "ACCESS_DENIED" in err or "Cannot parse" in err or "OAuthException" in err:
            return {"fetched": 0, "hint": _PERMISSION_HINTS.get(platform, ""), "error": "API permission denied"}
        return {"error": f"Sync failed: {e}", "fetched": 0}


@router.post("/{msg_id}/read")
async def mark_read(msg_id: str, request: Request):
    msg_id = (msg_id or "").strip()
    if not msg_id:
        return {"ok": False, "error": "message id required"}
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        conn.execute("UPDATE social_inbox SET is_read = 1 WHERE id = ?", (msg_id,))
    return {"ok": True}


@router.post("/{msg_id}/reply")
async def reply_message(msg_id: str, body: dict, request: Request):
    msg_id = (msg_id or "").strip()
    if not msg_id:
        return {"ok": False, "error": "message id required"}

    text = _strip_html(body.get("text") or "")[:MAX_REPLY_CHARS]
    if not text:
        return {"ok": False, "error": "reply text is required"}

    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT * FROM social_inbox WHERE id = ?", (msg_id,)
        ).fetchone()
    if not row:
        return {"ok": False, "error": "message not found"}

    msg = dict(row)
    try:
        if msg["platform"] == "instagram":
            result = await _reply_instagram(_get_instagram_settings(), msg, text)
        elif msg["platform"] == "linkedin":
            result = await _reply_linkedin(_get_linkedin_settings(), msg, text)
        else:
            return {"ok": False, "error": "unknown platform"}
    except Exception as e:
        return {"ok": False, "error": f"Reply failed: {e}"}

    if "error" in result:
        return {"ok": False, "error": result["error"]}

    with cache._conn() as conn:
        conn.execute(
            "UPDATE social_inbox SET replied_at = ?, is_read = 1 WHERE id = ?",
            (_now_iso(), msg_id),
        )
    return {"ok": True, "reply_id": result.get("reply_id", "")}
