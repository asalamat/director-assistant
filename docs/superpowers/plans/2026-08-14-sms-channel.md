# SMS Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SMS as a third channel in Cortex Executive Inbox's Social Inbox, alongside Instagram and LinkedIn, using Twilio's REST API polled on the existing background poll cycle — no public webhook endpoint required.

**Architecture:** A new `backend/routers/sms.py` owns Twilio settings, fetch, send, and AI-draft logic — mirroring how `routers/instagram.py` and `routers/social.py` own their platforms' settings/fetch/send. `routers/social_inbox.py` (the existing cross-platform orchestrator) gains an `"sms"` branch in its dispatch functions, exactly the same way it already dispatches between `"instagram"` and `"linkedin"`. Credentials are stored via the existing `config_secrets.py` keychain path. Inbound messages are pulled on the existing IMAP poll cycle (`workers/poll.py`) rather than via webhook, since the backend has no public endpoint.

**Refinement over the original spec:** The spec proposed a class-based `EmailProvider`-style `sms_provider.py` with a persisted cursor. Reading the actual codebase shows Instagram/LinkedIn don't use a class-based provider or a cursor at all — `social_inbox.py` dispatches via plain `if/elif` to platform-owned fetch functions, and dedup happens for free via `INSERT OR IGNORE` on the `id` primary key. This plan follows the real established pattern instead: no cursor, no provider class, just a `_fetch_sms()` function that returns the last 50 messages each poll and relies on existing dedup. Simpler, and consistent with how the other two platforms already work.

**Tech Stack:** FastAPI, SQLite (raw stdlib `sqlite3` via the existing `cache._conn()` pattern), httpx (already a dependency — Twilio's REST API is called directly with HTTP Basic Auth, no `twilio` SDK package added), React + TypeScript frontend, pytest + FastAPI TestClient for tests.

## Global Constraints

- No public webhook endpoint — inbound SMS must be pulled via polling, not pushed via webhook.
- No new Python dependency for Twilio — use `httpx` directly (already in `requirements.txt`), matching how Instagram/LinkedIn API calls are made elsewhere in this codebase.
- Credentials (`account_sid`, `auth_token`) must go through `config_secrets.py`'s keychain overlay/protect path — never stored as plaintext in `~/.director-assistant/app-config.json`.
- Follow existing file/dispatch patterns exactly: platform-specific logic lives in a platform-owned router file; `social_inbox.py` only orchestrates.
- v1 scope excludes: MMS/attachments, group texts, WhatsApp, read receipts/delivery status, multiple SMS numbers, urgency triage scoring, VIP alerts, and proactive-alert-engine coverage for SMS. Do not add these.

---

### Task 1: Add `"sms"` to the keychain-protected config keys

**Files:**
- Modify: `backend/services/config_secrets.py:35`
- Test: `backend/tests/test_sms.py` (new file)

**Interfaces:**
- Consumes: nothing new
- Produces: `"sms"` becomes a member of `config_secrets._JSON_KEYS`, so any `cfg["sms"]` dict written via `save_app_config()` is automatically moved to the OS keychain by the existing `protect_to_keychain()`, and restored by `overlay_from_keychain()` on load. No other task needs to call keychain functions directly — they just read/write `cfg["sms"]` via `load_app_config()`/`save_app_config()` and this happens transparently.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sms.py`:

```python
"""Tests for the SMS channel (backend/routers/sms.py) and its social_inbox integration."""

from services import config_secrets


def test_sms_is_a_protected_json_key():
    assert "sms" in config_secrets._JSON_KEYS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_sms.py::test_sms_is_a_protected_json_key -v`
Expected: FAIL — `assert "sms" in config_secrets._JSON_KEYS` is False.

- [ ] **Step 3: Add `"sms"` to `_JSON_KEYS`**

In `backend/services/config_secrets.py`, change line 35 from:

```python
_JSON_KEYS = {"ai_providers", "instagram", "linkedin"}
```

to:

```python
_JSON_KEYS = {"ai_providers", "instagram", "linkedin", "sms"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_sms.py::test_sms_is_a_protected_json_key -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/config_secrets.py backend/tests/test_sms.py
git commit -m "feat(sms): protect sms config in OS keychain"
```

---

### Task 2: SMS settings endpoints (`backend/routers/sms.py`)

**Files:**
- Create: `backend/routers/sms.py`
- Test: `backend/tests/test_sms.py` (append)

**Interfaces:**
- Consumes: `routers.config.load_app_config()`, `routers.config.save_app_config()` (both already exist, imported lazily inside functions the same way `routers/instagram.py` does it, to avoid circular imports)
- Produces:
  - `router = APIRouter(prefix="/api/sms", tags=["sms"])` — mounted in Task 4
  - `_get_sms_settings() -> dict` with keys `account_sid`, `auth_token`, `from_number` — used by Task 3 and Task 5
  - `GET /api/sms/settings` → `{"account_sid": str, "from_number": str, "auth_token_set": bool}`
  - `POST /api/sms/settings` (body: dict with any of `account_sid`, `auth_token`, `from_number`) → `{"status": "saved"}`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_sms.py`:

```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch


@pytest.fixture()
def sms_client(tmp_path, monkeypatch):
    mock_chroma = MagicMock()
    mock_chroma.get_or_create_collection.return_value.count.return_value = 0
    mock_chroma.get_or_create_collection.return_value.get.return_value = {
        "metadatas": [], "ids": [], "documents": []
    }
    mock_chroma.get_or_create_collection.return_value.query.return_value = {
        "ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]
    }
    with patch("chromadb.PersistentClient", return_value=mock_chroma):
        from main import app
        import routers.config as config_module
        cfg_file = tmp_path / "app-config.json"
        monkeypatch.setattr(config_module, "APP_CONFIG_PATH", cfg_file)
        with TestClient(app) as c:
            yield c


def test_sms_settings_round_trip(sms_client):
    r = sms_client.post("/api/sms/settings", json={
        "account_sid": "ACtest123", "auth_token": "secrettoken", "from_number": "+15551234567",
    })
    assert r.status_code == 200
    assert r.json() == {"status": "saved"}

    r = sms_client.get("/api/sms/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["account_sid"] == "ACtest123"
    assert body["from_number"] == "+15551234567"
    assert body["auth_token_set"] is True
    assert "auth_token" not in body  # never echo the raw token back
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_sms.py::test_sms_settings_round_trip -v`
Expected: FAIL — `404 Not Found` (no `/api/sms/settings` route exists yet), or `ModuleNotFoundError: routers.sms`.

- [ ] **Step 3: Create `backend/routers/sms.py`**

```python
"""SMS channel via Twilio's REST API — settings, inbound fetch, outbound send, AI draft.

No webhook is used: inbound messages are pulled on the existing background poll
cycle (see workers/poll.py) since this app has no public endpoint to receive
Twilio's webhook callbacks.
"""

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/sms", tags=["sms"])


def _get_sms_settings() -> dict:
    from routers.config import load_app_config
    cfg = load_app_config()
    sms = cfg.get("sms", {}) or {}
    return {
        "account_sid": sms.get("account_sid", ""),
        "auth_token": sms.get("auth_token", ""),
        "from_number": sms.get("from_number", ""),
    }


@router.get("/settings")
async def get_settings():
    s = _get_sms_settings()
    return {
        "account_sid": s["account_sid"],
        "from_number": s["from_number"],
        "auth_token_set": bool(s["auth_token"]),
    }


@router.post("/settings")
async def save_settings(body: dict):
    from routers.config import load_app_config, save_app_config
    cfg = load_app_config()
    sms = cfg.get("sms", {}) or {}
    for key in ("account_sid", "auth_token", "from_number"):
        if key in body and body[key] is not None:
            sms[key] = body[key]
    cfg["sms"] = sms
    save_app_config(cfg)
    return {"status": "saved"}
```

- [ ] **Step 4: Run test to verify it still fails with 404 (router not mounted yet)**

Run: `cd backend && python -m pytest tests/test_sms.py::test_sms_settings_round_trip -v`
Expected: still FAIL with 404 — the router file exists but isn't registered with the FastAPI app yet. This is expected at this point; Task 4 registers it. Confirm the failure is specifically 404, not an import error, before moving on.

- [ ] **Step 5: Commit (router not yet wired up — that's fine, next task wires it)**

```bash
git add backend/routers/sms.py backend/tests/test_sms.py
git commit -m "feat(sms): add SMS settings endpoints (not yet mounted)"
```

---

### Task 3: Twilio fetch/send + connection test endpoint

**Files:**
- Modify: `backend/routers/sms.py`
- Test: `backend/tests/test_sms.py` (append)

**Interfaces:**
- Consumes: `_get_sms_settings()` from Task 2
- Produces:
  - `async def _send_sms(to: str, body: str) -> dict` — returns `{"sid": str}` on success or `{"error": str}` on failure. Used by Task 5 (social_inbox reply dispatch) and by `draft_reply`/`test_connection` below.
  - `async def _fetch_sms() -> list[dict]` — returns a list of dicts shaped like `social_inbox` rows (`id`, `platform`, `type`, `sender_name`, `sender_id`, `content`, `created_at`), raises `ValueError` if not configured. Used by Task 5's `sync_platform()`.
  - `POST /api/sms/test` → `{"ok": bool, "error": str | None}`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_sms.py`:

```python
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_send_sms_success(monkeypatch):
    from routers import sms as sms_module
    monkeypatch.setattr(sms_module, "_get_sms_settings", lambda: {
        "account_sid": "ACtest", "auth_token": "tok", "from_number": "+15550000000",
    })

    fake_response = MagicMock()
    fake_response.status_code = 201
    fake_response.json.return_value = {"sid": "SMxxx"}

    mock_http = AsyncMock()
    mock_http.post.return_value = fake_response
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_http)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.sms.httpx.AsyncClient", return_value=mock_client):
        result = await sms_module._send_sms("+15551112222", "hello")

    assert result == {"sid": "SMxxx"}


@pytest.mark.asyncio
async def test_send_sms_not_configured(monkeypatch):
    from routers import sms as sms_module
    monkeypatch.setattr(sms_module, "_get_sms_settings", lambda: {
        "account_sid": "", "auth_token": "", "from_number": "",
    })
    result = await sms_module._send_sms("+15551112222", "hello")
    assert "error" in result


@pytest.mark.asyncio
async def test_fetch_sms_maps_inbound_messages(monkeypatch):
    from routers import sms as sms_module
    monkeypatch.setattr(sms_module, "_get_sms_settings", lambda: {
        "account_sid": "ACtest", "auth_token": "tok", "from_number": "+15550000000",
    })

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "messages": [
            {"sid": "SM111", "from": "+15551112222", "to": "+15550000000",
             "body": "hi there", "date_sent": "2026-08-14T10:00:00Z", "direction": "inbound"},
            {"sid": "SM222", "from": "+15550000000", "to": "+15551112222",
             "body": "outbound one, should be skipped", "date_sent": "2026-08-14T10:01:00Z",
             "direction": "outbound-api"},
        ]
    }

    mock_http = AsyncMock()
    mock_http.get.return_value = fake_response
    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_http)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.sms.httpx.AsyncClient", return_value=mock_client):
        rows = await sms_module._fetch_sms()

    assert len(rows) == 1
    assert rows[0]["id"] == "sms_SM111"
    assert rows[0]["platform"] == "sms"
    assert rows[0]["sender_id"] == "+15551112222"
    assert rows[0]["content"] == "hi there"


def test_sms_test_connection_not_configured(sms_client):
    r = sms_client.post("/api/sms/test")
    assert r.status_code == 200
    assert r.json()["ok"] is False
```

Add `import pytest` at the top of the file if not already present from Task 2 (it is), and add `pytest-asyncio` usage note: this project's existing async tests (see `test_api.py`) use `@pytest.mark.asyncio` with `pytest-asyncio` already configured — no new test dependency needed. If `pytest.ini`/`pyproject.toml` doesn't have `asyncio_mode = auto`, mark each async test explicitly with `@pytest.mark.asyncio` as shown above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_sms.py -v`
Expected: FAIL — `_send_sms`, `_fetch_sms` don't exist yet; `/api/sms/test` is 404.

- [ ] **Step 3: Implement fetch/send/test in `backend/routers/sms.py`**

Add to `backend/routers/sms.py` (after `save_settings`):

```python
async def _send_sms(to: str, body: str) -> dict:
    """Send an SMS via Twilio. Returns {sid} on success or {error} on failure."""
    settings = _get_sms_settings()
    sid, token, from_number = settings["account_sid"], settings["auth_token"], settings["from_number"]
    if not sid or not token or not from_number:
        return {"error": "SMS not configured — go to Settings → SMS"}
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    async with httpx.AsyncClient(timeout=15.0, auth=(sid, token)) as http:
        r = await http.post(url, data={"To": to, "From": from_number, "Body": body})
    if r.status_code >= 300:
        return {"error": f"Twilio send failed {r.status_code}: {r.text[:200]}"}
    return {"sid": (r.json() or {}).get("sid", "")}


async def _fetch_sms() -> list[dict]:
    """Fetch recent inbound SMS messages, shaped as social_inbox rows."""
    settings = _get_sms_settings()
    sid, token, from_number = settings["account_sid"], settings["auth_token"], settings["from_number"]
    if not sid or not token or not from_number:
        raise ValueError("SMS not configured — go to Settings → SMS")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    async with httpx.AsyncClient(timeout=15.0, auth=(sid, token)) as http:
        r = await http.get(url, params={"To": from_number, "PageSize": 50})
    if r.status_code >= 300:
        raise ValueError(f"Twilio fetch failed {r.status_code}: {r.text[:200]}")
    rows: list[dict] = []
    for m in (r.json() or {}).get("messages", []):
        if m.get("direction") != "inbound":
            continue
        msid = m.get("sid")
        if not msid:
            continue
        rows.append({
            "id": f"sms_{msid}",
            "platform": "sms",
            "type": "dm",
            "sender_name": m.get("from") or "",
            "sender_id": m.get("from") or "",
            "content": m.get("body") or "",
            "created_at": m.get("date_sent") or datetime.now(timezone.utc).isoformat(),
        })
    return rows


@router.post("/test")
async def test_connection():
    """Send a test SMS to the configured From number to confirm credentials work."""
    settings = _get_sms_settings()
    if not settings["from_number"]:
        return {"ok": False, "error": "Set a From Number first"}
    result = await _send_sms(settings["from_number"], "Cortex Executive Inbox: SMS test message")
    if "error" in result:
        return {"ok": False, "error": result["error"]}
    return {"ok": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_sms.py -v`
Expected: `test_send_sms_success`, `test_send_sms_not_configured`, `test_fetch_sms_maps_inbound_messages` PASS. `test_sms_test_connection_not_configured` still fails with 404 (router not mounted) — expected until Task 4; confirm it's specifically a 404.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/sms.py backend/tests/test_sms.py
git commit -m "feat(sms): add Twilio fetch/send and connection test"
```

---

### Task 4: Register the SMS router

**Files:**
- Modify: `backend/main.py:78` (add import), and near line 348 (add `include_router` call)

**Interfaces:**
- Consumes: `routers.sms.router` (from Task 2/3)
- Produces: `/api/sms/*` routes become reachable

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_sms.py`:

```python
def test_sms_settings_route_is_mounted(sms_client):
    r = sms_client.get("/api/sms/settings")
    assert r.status_code == 200


def test_sms_test_connection_now_reachable(sms_client):
    r = sms_client.post("/api/sms/test")
    assert r.status_code == 200
    assert r.json()["ok"] is False  # still unconfigured, but no longer 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_sms.py::test_sms_settings_route_is_mounted -v`
Expected: FAIL with 404 (router imported but not registered — actually not even imported yet).

- [ ] **Step 3: Register the router in `main.py`**

In `backend/main.py`, change line 78 from:

```python
from routers import social_inbox as social_inbox_router
```

to:

```python
from routers import social_inbox as social_inbox_router
from routers import sms as sms_router
```

Then find the line `app.include_router(social_inbox_router.router)` (around line 348) and add directly after it:

```python
app.include_router(social_inbox_router.router)
app.include_router(sms_router.router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_sms.py -v`
Expected: ALL tests in the file PASS now, including the two `test_sms_test_connection*` tests that were previously blocked on 404.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/tests/test_sms.py
git commit -m "feat(sms): mount SMS router"
```

---

### Task 5: Wire SMS into `social_inbox.py` (migration, dispatch, unread count)

**Files:**
- Modify: `backend/routers/social_inbox.py:22` (`VALID_PLATFORMS`), `:26-47` (`_ensure_tables`), `:312-322` (`sync_platform`), `:359-372` (`unread_count`), `:422-460` (`reply_message`)
- Test: `backend/tests/test_sms.py` (append)

**Interfaces:**
- Consumes: `routers.sms._fetch_sms()` and `routers.sms._send_sms()` (Task 3)
- Produces: `"sms"` is now a valid value everywhere `platform` is checked in `social_inbox.py`; existing rows with `platform IN ('instagram','linkedin')` are preserved across the schema migration.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_sms.py`:

```python
def _make_social_inbox_cache(tmp_path):
    import sqlite3
    from contextlib import contextmanager

    db_file = tmp_path / "social.db"

    @contextmanager
    def _conn():
        conn = sqlite3.connect(str(db_file))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    cache = MagicMock()
    cache._conn = _conn
    return cache


def test_old_social_inbox_table_migrates_to_allow_sms(tmp_path):
    from routers import social_inbox

    cache = _make_social_inbox_cache(tmp_path)
    # Simulate a pre-migration DB: old CHECK constraint, one existing row.
    with cache._conn() as conn:
        conn.execute("""
            CREATE TABLE social_inbox (
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
            "INSERT INTO social_inbox (id, platform, type, content, created_at) "
            "VALUES ('ig_dm_1', 'instagram', 'dm', 'hello', '2026-01-01T00:00:00Z')"
        )

    social_inbox._ensure_tables(cache)  # should migrate in place

    with cache._conn() as conn:
        # Old row survived
        row = conn.execute("SELECT * FROM social_inbox WHERE id = 'ig_dm_1'").fetchone()
        assert row is not None
        assert row["platform"] == "instagram"
        # New platform value is now accepted
        conn.execute(
            "INSERT INTO social_inbox (id, platform, type, content, created_at) "
            "VALUES ('sms_1', 'sms', 'dm', 'hi', '2026-01-01T00:00:00Z')"
        )
        count = conn.execute("SELECT COUNT(*) AS c FROM social_inbox").fetchone()["c"]
        assert count == 2


@pytest.mark.asyncio
async def test_sync_platform_sms_dispatches_to_fetch_sms(tmp_path, monkeypatch):
    from routers import social_inbox

    cache = _make_social_inbox_cache(tmp_path)
    social_inbox._ensure_tables(cache)

    async def fake_fetch_sms():
        return [{
            "id": "sms_SM1", "platform": "sms", "type": "dm",
            "sender_name": "+15551112222", "sender_id": "+15551112222",
            "content": "hi", "created_at": "2026-08-14T10:00:00Z",
        }]

    monkeypatch.setattr("routers.sms._fetch_sms", fake_fetch_sms)
    count = await social_inbox.sync_platform(cache, "sms")
    assert count == 1

    with cache._conn() as conn:
        row = conn.execute("SELECT * FROM social_inbox WHERE id = 'sms_SM1'").fetchone()
    assert row["content"] == "hi"


@pytest.mark.asyncio
async def test_unread_count_includes_sms(tmp_path):
    from routers import social_inbox

    cache = _make_social_inbox_cache(tmp_path)
    social_inbox._ensure_tables(cache)
    with cache._conn() as conn:
        conn.execute(
            "INSERT INTO social_inbox (id, platform, type, content, created_at, is_read) "
            "VALUES ('sms_1', 'sms', 'dm', 'hi', '2026-08-14T10:00:00Z', 0)"
        )

    class FakeRequest:
        class app:
            class state:
                pass
    FakeRequest.app.state.cache = cache

    result = await social_inbox.unread_count(FakeRequest())
    assert result["sms"] == 1


@pytest.mark.asyncio
async def test_reply_message_sms_calls_send_sms(tmp_path, monkeypatch):
    from routers import social_inbox

    cache = _make_social_inbox_cache(tmp_path)
    social_inbox._ensure_tables(cache)
    with cache._conn() as conn:
        conn.execute(
            "INSERT INTO social_inbox (id, platform, type, sender_id, content, created_at) "
            "VALUES ('sms_SM1', 'sms', 'dm', '+15551112222', 'hi', '2026-08-14T10:00:00Z')"
        )

    async def fake_send_sms(to, body):
        assert to == "+15551112222"
        assert body == "reply text"
        return {"sid": "SMreply1"}

    monkeypatch.setattr("routers.sms._send_sms", fake_send_sms)

    class FakeRequest:
        class app:
            class state:
                pass
    FakeRequest.app.state.cache = cache

    result = await social_inbox.reply_message("sms_SM1", {"text": "reply text"}, FakeRequest())
    assert result["ok"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_sms.py -v -k "migrat or sync_platform_sms or unread_count_includes_sms or reply_message_sms"`
Expected: FAIL — `"sms"` not yet accepted by the CHECK constraint, `sync_platform`/`reply_message` don't know about `"sms"`, `unread_count` doesn't return an `"sms"` key.

- [ ] **Step 3: Implement the migration and dispatch wiring**

In `backend/routers/social_inbox.py`, change line 22 from:

```python
VALID_PLATFORMS = ("instagram", "linkedin")
```

to:

```python
VALID_PLATFORMS = ("instagram", "linkedin", "sms")
```

Replace the `_ensure_tables` function (lines 26-47) with:

```python
def _ensure_tables(cache) -> None:
    with cache._conn() as conn:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='social_inbox'"
        ).fetchone()
        ddl = (row["sql"] if row else "") or ""
        if ddl and "'sms'" not in ddl:
            # Older DBs have CHECK(platform IN ('instagram','linkedin')) — rebuild
            # the table to widen the constraint, preserving existing rows.
            conn.executescript("""
                ALTER TABLE social_inbox RENAME TO social_inbox_old;
                CREATE TABLE social_inbox (
                    id TEXT PRIMARY KEY,
                    platform TEXT NOT NULL CHECK(platform IN ('instagram','linkedin','sms')),
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
                );
                INSERT INTO social_inbox SELECT * FROM social_inbox_old;
                DROP TABLE social_inbox_old;
                CREATE INDEX IF NOT EXISTS idx_social_inbox_platform
                    ON social_inbox(platform, is_read, created_at DESC);
            """)
            return
        conn.execute("""
            CREATE TABLE IF NOT EXISTS social_inbox (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL CHECK(platform IN ('instagram','linkedin','sms')),
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
```

Update `sync_platform` (lines 312-322) to:

```python
async def sync_platform(cache, platform: str) -> int:
    """Fetch + store messages for one platform. Returns count of new messages."""
    if platform == "instagram":
        settings = _get_instagram_settings()
        rows = await _fetch_instagram(settings)
    elif platform == "linkedin":
        settings = _get_linkedin_settings()
        rows = await _fetch_linkedin(cache, settings)
    elif platform == "sms":
        from routers.sms import _fetch_sms
        rows = await _fetch_sms()
    else:
        raise ValueError(f"Unknown platform: {platform}")
    return _upsert_messages(cache, rows)
```

Update `unread_count` (lines 359-372) to include `"sms"`:

```python
@router.get("/unread-count")
async def unread_count(request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT platform, COUNT(*) AS c FROM social_inbox "
            "WHERE is_read = 0 GROUP BY platform"
        ).fetchall()
    counts = {"instagram": 0, "linkedin": 0, "sms": 0}
    for r in rows:
        if r["platform"] in counts:
            counts[r["platform"]] = r["c"]
    return counts
```

Update `reply_message` (lines 422-460) to add an `elif` branch before the `else`:

```python
    msg = dict(row)
    try:
        if msg["platform"] == "instagram":
            result = await _reply_instagram(_get_instagram_settings(), msg, text)
        elif msg["platform"] == "linkedin":
            result = await _reply_linkedin(_get_linkedin_settings(), msg, text)
        elif msg["platform"] == "sms":
            from routers.sms import _send_sms
            result = await _send_sms(msg["sender_id"], text)
        else:
            return {"ok": False, "error": "unknown platform"}
    except Exception as e:
        return {"ok": False, "error": f"Reply failed: {e}"}
```

(Only the body of the `try` block changes — the surrounding function, the `if "error" in result` check below it, and the final `UPDATE`/return are unchanged.)

Also update the `sync_inbox` endpoint's error message (line 396) from:

```python
        return {"error": "platform must be 'instagram' or 'linkedin'", "fetched": 0}
```

to:

```python
        return {"error": "platform must be 'instagram', 'linkedin', or 'sms'", "fetched": 0}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_sms.py -v`
Expected: ALL tests PASS.

- [ ] **Step 5: Run the full backend test suite to confirm no regression**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All existing tests still PASS (the migration only changes behavior for pre-existing DBs with the old CHECK constraint; a fresh `CREATE TABLE IF NOT EXISTS` path is unaffected for new installs).

- [ ] **Step 6: Commit**

```bash
git add backend/routers/social_inbox.py backend/tests/test_sms.py
git commit -m "feat(sms): wire SMS into social_inbox dispatch, migration, unread count"
```

---

### Task 6: Poll SMS on the existing background poll cycle

**Files:**
- Modify: `backend/workers/poll.py` (near line 291-296, the wake-due-snoozed check inside `_do_poll_cycle_inner`)
- Test: `backend/tests/test_sms.py` (append)

**Interfaces:**
- Consumes: `routers.social_inbox.sync_platform(cache, "sms")` (Task 5), `routers.sms._get_sms_settings()` (Task 2)
- Produces: SMS messages are fetched automatically every poll cycle when SMS is configured; no behavior change when it isn't.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_sms.py`:

```python
@pytest.mark.asyncio
async def test_poll_cycle_skips_sms_when_not_configured(monkeypatch):
    from workers import poll as poll_module
    from routers import sms as sms_module

    monkeypatch.setattr(sms_module, "_get_sms_settings", lambda: {
        "account_sid": "", "auth_token": "", "from_number": "",
    })

    called = {"sync": False}

    async def fake_sync_platform(cache, platform):
        called["sync"] = True
        return 0

    monkeypatch.setattr("routers.social_inbox.sync_platform", fake_sync_platform)
    await poll_module._poll_sms(MagicMock())
    assert called["sync"] is False


@pytest.mark.asyncio
async def test_poll_cycle_syncs_sms_when_configured(monkeypatch):
    from workers import poll as poll_module
    from routers import sms as sms_module

    monkeypatch.setattr(sms_module, "_get_sms_settings", lambda: {
        "account_sid": "ACtest", "auth_token": "tok", "from_number": "+15550000000",
    })

    called = {"platform": None}

    async def fake_sync_platform(cache, platform):
        called["platform"] = platform
        return 3

    monkeypatch.setattr("routers.social_inbox.sync_platform", fake_sync_platform)
    fetched = await poll_module._poll_sms(MagicMock())
    assert called["platform"] == "sms"
    assert fetched == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_sms.py -v -k poll_cycle`
Expected: FAIL — `poll_module._poll_sms` doesn't exist yet (`AttributeError`).

- [ ] **Step 3: Add `_poll_sms` and call it from the poll cycle**

In `backend/workers/poll.py`, add a new function near `_do_poll_cycle_inner` (place it directly above that function, after the existing imports/helpers at the top of the file):

```python
async def _poll_sms(cache) -> int:
    """Fetch new SMS messages if configured. Returns count fetched, 0 if not configured."""
    from routers.sms import _get_sms_settings
    settings = _get_sms_settings()
    if not settings["account_sid"] or not settings["auth_token"] or not settings["from_number"]:
        return 0
    from routers.social_inbox import sync_platform
    return await sync_platform(cache, "sms")
```

Then, inside `_do_poll_cycle_inner`, find this existing block (around line 291-296):

```python
    try:
        woken = cache.wake_due_snoozed()
        if woken:
            print(f"[poll] woke {len(woken)} snoozed email(s)")
    except Exception as e:
        print(f"[poll] wake-due check failed: {e}")
```

and add directly after it (still inside `_do_poll_cycle_inner`, before the `_last_poll_new = new_total` line):

```python
    try:
        sms_new = await _poll_sms(cache)
        if sms_new:
            print(f"[poll] fetched {sms_new} new SMS message(s)")
    except Exception as e:
        print(f"[poll] SMS poll failed: {e}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_sms.py -v -k poll_cycle`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && python -m pytest tests/ -v`
Expected: All tests PASS, including `tests/test_workers.py` (SMS polling failure is caught and logged, never raises out of `_do_poll_cycle_inner`).

- [ ] **Step 6: Commit**

```bash
git add backend/workers/poll.py backend/tests/test_sms.py
git commit -m "feat(sms): poll SMS on the existing background poll cycle"
```

---

### Task 7: AI draft-reply endpoint for SMS

**Files:**
- Modify: `backend/routers/sms.py`
- Test: `backend/tests/test_sms.py` (append)

**Interfaces:**
- Consumes: `request.app.state.advisor.ai` (the existing multi-provider `AIClient` instance, same one `routers/triage.py`'s `batch_triage` already uses via `advisor.ai.messages.create(...)`)
- Produces: `POST /api/sms/draft-reply` (body: `{"text": str}`) → `{"draft": str, "error": str | None}`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_sms.py`:

```python
def test_draft_reply_requires_text(sms_client):
    r = sms_client.post("/api/sms/draft-reply", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["draft"] == ""
    assert body["error"]


def test_draft_reply_generates_draft(sms_client, monkeypatch):
    from main import app

    fake_content = MagicMock()
    fake_content.text = "Sounds good, see you then!"
    fake_response = MagicMock()
    fake_response.content = [fake_content]

    mock_ai = AsyncMock()
    mock_ai.messages.create = AsyncMock(return_value=fake_response)

    class FakeAdvisor:
        ai = mock_ai

    monkeypatch.setattr(app.state, "advisor", FakeAdvisor())

    r = sms_client.post("/api/sms/draft-reply", json={"text": "Are we still on for 3pm?"})
    assert r.status_code == 200
    body = r.json()
    assert body["draft"] == "Sounds good, see you then!"
    assert not body.get("error")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_sms.py -v -k draft_reply`
Expected: FAIL — `/api/sms/draft-reply` doesn't exist yet (404).

- [ ] **Step 3: Implement the endpoint**

Add to `backend/routers/sms.py` (after `test_connection`):

```python
@router.post("/draft-reply")
async def draft_reply(body: dict, request: Request):
    """Generate a short AI reply draft for an inbound SMS thread."""
    incoming_text = (body.get("text") or "").strip()
    if not incoming_text:
        return {"draft": "", "error": "text is required"}
    advisor = request.app.state.advisor
    prompt = (
        "Write a short SMS reply (under 160 characters, no greeting or signature) "
        f"to this text message:\n\n{incoming_text}"
    )
    try:
        resp = await advisor.ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=100,
            messages=[{"role": "user", "content": prompt}],
        )
        draft = resp.content[0].text.strip()
    except Exception as e:
        return {"draft": "", "error": f"Draft generation failed: {e}"}
    return {"draft": draft}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_sms.py -v`
Expected: ALL tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/sms.py backend/tests/test_sms.py
git commit -m "feat(sms): add AI draft-reply endpoint"
```

---

### Task 8: Frontend types and API client

**Files:**
- Modify: `frontend/src/types/index.ts:385` (`SocialMessage.platform`)
- Modify: `frontend/src/api/client.ts:1271` (`getSocialUnreadCount` return type), and add new SMS client methods near the Social Inbox section (after line 1273)

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `SocialMessage.platform` type now includes `'sms'`
  - `api.getSmsSettings(): Promise<{account_sid: string; from_number: string; auth_token_set: boolean}>`
  - `api.saveSmsSettings(data: {account_sid?: string; auth_token?: string; from_number?: string}): Promise<{status: string}>`
  - `api.testSmsConnection(): Promise<{ok: boolean; error?: string}>`
  - `api.draftSmsReply(text: string): Promise<{draft: string; error?: string}>`
  - `api.getSocialUnreadCount(): Promise<{instagram: number; linkedin: number; sms: number}>` (widened)

- [ ] **Step 1: Update the `SocialMessage` type**

In `frontend/src/types/index.ts`, change line 385 from:

```typescript
  platform: 'instagram' | 'linkedin'
```

to:

```typescript
  platform: 'instagram' | 'linkedin' | 'sms'
```

- [ ] **Step 2: Widen `getSocialUnreadCount` and add SMS client methods**

In `frontend/src/api/client.ts`, change line 1271-1273 from:

```typescript
  getSocialUnreadCount(): Promise<{ instagram: number; linkedin: number }> {
    return request('/social/inbox/unread-count')
  },
```

to:

```typescript
  getSocialUnreadCount(): Promise<{ instagram: number; linkedin: number; sms: number }> {
    return request('/social/inbox/unread-count')
  },

  // SMS
  getSmsSettings(): Promise<{ account_sid: string; from_number: string; auth_token_set: boolean }> {
    return request('/sms/settings')
  },
  saveSmsSettings(data: { account_sid?: string; auth_token?: string; from_number?: string }): Promise<{ status: string }> {
    return request('/sms/settings', { method: 'POST', body: JSON.stringify(data) })
  },
  testSmsConnection(): Promise<{ ok: boolean; error?: string }> {
    return request('/sms/test', { method: 'POST' })
  },
  draftSmsReply(text: string): Promise<{ draft: string; error?: string }> {
    return request('/sms/draft-reply', { method: 'POST', body: JSON.stringify({ text }) })
  },
```

- [ ] **Step 3: Verify the frontend still type-checks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. (This step has no "test framework" test — TypeScript compilation is the check, matching how this codebase verifies frontend types elsewhere; there is no Jest/Vitest suite in this repo to add a unit test to.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/client.ts
git commit -m "feat(sms): add SMS types and API client methods"
```

---

### Task 9: `SmsSettings.tsx` component + mount in Settings

**Files:**
- Create: `frontend/src/components/SmsSettings.tsx`
- Modify: `frontend/src/components/Settings.tsx:6` (import), `:508-509` (mount inside the existing "Communication" `IntegrationCard` group)

**Interfaces:**
- Consumes: `api.getSmsSettings`, `api.saveSmsSettings`, `api.testSmsConnection` (Task 8)
- Produces: `<SmsSettings />` component, mounted in Settings → Integrations → Communication

- [ ] **Step 1: Create `frontend/src/components/SmsSettings.tsx`**

```typescript
import { useState, useEffect } from 'react'
import { api } from '../api/client'

export function SmsSettings() {
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [fromNumber, setFromNumber] = useState('')
  const [authTokenSet, setAuthTokenSet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  useEffect(() => {
    api.getSmsSettings().then(s => {
      setAccountSid(s.account_sid)
      setFromNumber(s.from_number)
      setAuthTokenSet(s.auth_token_set)
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    const payload: { account_sid?: string; auth_token?: string; from_number?: string } = {
      account_sid: accountSid,
      from_number: fromNumber,
    }
    if (authToken.trim()) payload.auth_token = authToken.trim()
    await api.saveSmsSettings(payload).catch(() => {})
    setSaving(false)
    setSaved(true)
    setAuthToken('')
    if (authToken.trim()) setAuthTokenSet(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api.testSmsConnection()
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message })
    }
    setTesting(false)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Create a free Twilio account at{' '}
        <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer" className="underline">
          twilio.com
        </a>
        , buy a phone number (~$1/mo), then paste your Account SID and Auth Token from the Twilio console below.
      </p>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Account SID</label>
        <input value={accountSid} onChange={e => setAccountSid(e.target.value)}
          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
          Auth Token {authTokenSet && <span className="text-green-600 normal-case font-normal">(saved)</span>}
        </label>
        <input value={authToken} onChange={e => setAuthToken(e.target.value)} type="password"
          placeholder={authTokenSet ? 'Enter a new token to replace it' : 'Your Twilio Auth Token'}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">From Number</label>
        <input value={fromNumber} onChange={e => setFromNumber(e.target.value)}
          placeholder="+15551234567"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
        <button onClick={test} disabled={testing}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {testing ? 'Sending…' : 'Test Connection'}
        </button>
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
            {testResult.ok ? '✓ Test SMS sent' : `✗ ${testResult.error || 'Failed'}`}
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in Settings.tsx**

In `frontend/src/components/Settings.tsx`, change line 6 from:

```typescript
import { WebhooksSettings } from './WebhooksSettings'
```

to:

```typescript
import { WebhooksSettings } from './WebhooksSettings'
import { SmsSettings } from './SmsSettings'
```

Then change lines 508-509 from:

```typescript
                  <IntegrationCard title="Slack & Teams Notifications" icon={<IconSlack />} badge="bg-purple-100 text-purple-600"><NotifySettings /></IntegrationCard>
                  <IntegrationCard title="Webhooks & Zapier" icon={<IconZap />} badge="bg-orange-100 text-orange-600"><WebhooksSettings /></IntegrationCard>
```

to:

```typescript
                  <IntegrationCard title="Slack & Teams Notifications" icon={<IconSlack />} badge="bg-purple-100 text-purple-600"><NotifySettings /></IntegrationCard>
                  <IntegrationCard title="Webhooks & Zapier" icon={<IconZap />} badge="bg-orange-100 text-orange-600"><WebhooksSettings /></IntegrationCard>
                  <IntegrationCard title="SMS (Twilio)" icon={<span className="text-base">💬</span>} badge="bg-teal-100 text-teal-600"><SmsSettings /></IntegrationCard>
```

- [ ] **Step 3: Verify the frontend builds**

Run: `cd frontend && npx tsc --noEmit && npx vite build`
Expected: builds cleanly, no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SmsSettings.tsx frontend/src/components/Settings.tsx
git commit -m "feat(sms): add SMS settings panel to Settings > Integrations"
```

---

### Task 10: Wire SMS into `SocialInbox.tsx`

**Files:**
- Modify: `frontend/src/components/social/SocialInbox.tsx`

**Interfaces:**
- Consumes: `api.draftSmsReply` (Task 8), the widened `SocialMessage.platform` type (Task 8)
- Produces: SMS messages appear in the existing Social Inbox UI with a filter tab, badge, sync support, and an AI "Draft Reply" button on SMS threads

- [ ] **Step 1: Widen the platform filter type and badge map**

In `frontend/src/components/social/SocialInbox.tsx`, change line 5 from:

```typescript
type PlatformFilter = 'all' | 'instagram' | 'linkedin'
```

to:

```typescript
type PlatformFilter = 'all' | 'instagram' | 'linkedin' | 'sms'
```

Change lines 7-10 from:

```typescript
const PLATFORM_BADGE: Record<string, { icon: string; cls: string; label: string }> = {
  instagram: { icon: 'IG', cls: 'bg-pink-100 text-pink-600', label: 'Instagram' },
  linkedin: { icon: 'LI', cls: 'bg-blue-100 text-blue-700', label: 'LinkedIn' },
}
```

to:

```typescript
const PLATFORM_BADGE: Record<string, { icon: string; cls: string; label: string }> = {
  instagram: { icon: 'IG', cls: 'bg-pink-100 text-pink-600', label: 'Instagram' },
  linkedin: { icon: 'LI', cls: 'bg-blue-100 text-blue-700', label: 'LinkedIn' },
  sms: { icon: 'SMS', cls: 'bg-teal-100 text-teal-600', label: 'SMS' },
}
```

- [ ] **Step 2: Widen the platform filter buttons and sync targets**

Change line 110 from:

```typescript
          {(['all', 'instagram', 'linkedin'] as PlatformFilter[]).map(p => (
```

to:

```typescript
          {(['all', 'instagram', 'linkedin', 'sms'] as PlatformFilter[]).map(p => (
```

Change line 53 from:

```typescript
    const targets = platform === 'all' ? ['instagram', 'linkedin'] : [platform]
```

to:

```typescript
    const targets = platform === 'all' ? ['instagram', 'linkedin', 'sms'] : [platform]
```

- [ ] **Step 3: Add a Draft Reply button for SMS messages**

Add draft state near the other `useState` declarations (after line 33, `const [feedback, ...] = useState...`):

```typescript
  const [drafting, setDrafting] = useState(false)
```

Add a `draftReply` function near `sendReply` (after it, around line 102):

```typescript
  const draftReply = async (m: SocialMessage) => {
    setDrafting(true)
    try {
      const r = await api.draftSmsReply(m.content)
      if (r.draft) setReplyText(r.draft)
    } catch {
      // silently ignore — user can still type a manual reply
    }
    setDrafting(false)
  }
```

In the expanded message view (around lines 193-212), change the reply button row from:

```typescript
                  <div className="flex items-center gap-2">
                    {feedback?.id === m.id && (
                      <span className={`text-[11px] ${feedback.ok ? 'text-green-600' : 'text-red-500'}`}>{feedback.text}</span>
                    )}
                    <button onClick={() => sendReply(m)} disabled={replying || !replyText.trim()}
                      className="ml-auto text-xs bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-50 transition">
                      {replying ? 'Sending…' : 'Reply'}
                    </button>
                  </div>
```

to:

```typescript
                  <div className="flex items-center gap-2">
                    {feedback?.id === m.id && (
                      <span className={`text-[11px] ${feedback.ok ? 'text-green-600' : 'text-red-500'}`}>{feedback.text}</span>
                    )}
                    {m.platform === 'sms' && (
                      <button onClick={() => draftReply(m)} disabled={drafting}
                        className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 transition">
                        {drafting ? 'Drafting…' : '✨ Draft Reply'}
                      </button>
                    )}
                    <button onClick={() => sendReply(m)} disabled={replying || !replyText.trim()}
                      className="ml-auto text-xs bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-50 transition">
                      {replying ? 'Sending…' : 'Reply'}
                    </button>
                  </div>
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd frontend && npx tsc --noEmit && npx vite build`
Expected: builds cleanly, no type errors.

- [ ] **Step 5: Manual verification**

With SMS credentials configured in Settings (Task 9), open Social Inbox, click the "SMS" filter tab, click "↻ Sync" — confirm real inbound texts appear. Expand one, click "✨ Draft Reply", confirm a short draft appears in the textarea, edit if needed, click "Reply", confirm the SMS is actually delivered to the sender's phone.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/social/SocialInbox.tsx
git commit -m "feat(sms): wire SMS into Social Inbox UI with AI draft reply"
```

---

## Self-Review Notes

- **Spec coverage:** All six numbered sections of the spec are covered — delivery mechanism (Task 6), data model/migration (Task 5), backend provider (Tasks 2-3, 7), Settings UI (Task 9), frontend (Task 10). The spec's uncertain point ("new endpoint or reuse existing reply endpoint") is resolved: Task 5 reuses the existing `reply_message` endpoint, no new reply endpoint needed.
- **Deviation from spec, called out explicitly:** No class-based `sms_provider.py`, no persisted poll cursor — see the "Refinement over the original spec" note under Architecture. This was discovered by reading the actual Instagram/LinkedIn implementation during planning, which uses a simpler pattern than what the spec (written before this level of code inspection) assumed.
- **Type consistency check:** `_fetch_sms()` (Task 3) returns dicts matching exactly what `_upsert_messages()` (existing, unmodified) expects — verified against its actual `INSERT` column list. `_send_sms(to, body)` signature is used identically in Task 3's `test_connection`, Task 5's `reply_message` branch, and Task 7's future extension point. Frontend `api.draftSmsReply(text)` matches the backend `draft-reply` endpoint's `{"text": ...}` body shape.
- **No placeholders:** every step has literal code, not descriptions of code.
