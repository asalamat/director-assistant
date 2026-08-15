"""Tests for the SMS channel (backend/routers/sms.py) and its social_inbox integration."""

from services import config_secrets
import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch


def test_sms_is_a_protected_json_key():
    assert "sms" in config_secrets._JSON_KEYS


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


def test_sms_settings_route_is_mounted(sms_client):
    r = sms_client.get("/api/sms/settings")
    assert r.status_code == 200


def test_sms_test_connection_now_reachable(sms_client):
    r = sms_client.post("/api/sms/test")
    assert r.status_code == 200
    assert r.json()["ok"] is False  # still unconfigured, but no longer 404


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


def test_migration_rolls_back_cleanly_on_schema_drift(tmp_path):
    """If a future schema drift ever makes the INSERT...SELECT column list invalid,
    the whole migration (RENAME + CREATE + INSERT) must roll back atomically —
    not strand data in a renamed 'social_inbox_old' table."""
    from routers import social_inbox

    cache = _make_social_inbox_cache(tmp_path)
    # Old table is missing a column (`fetched_at`) that the migration's explicit
    # SELECT list requires — this must fail loudly instead of silently transposing.
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
                created_at TEXT NOT NULL
            )
        """)
        conn.execute(
            "INSERT INTO social_inbox (id, platform, type, content, created_at) "
            "VALUES ('ig_dm_1', 'instagram', 'dm', 'hello', '2026-01-01T00:00:00Z')"
        )

    with pytest.raises(Exception):
        social_inbox._ensure_tables(cache)

    with cache._conn() as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        # No stranded 'social_inbox_old' table, and the original data survives.
        assert tables == {"social_inbox"}
        row = conn.execute("SELECT * FROM social_inbox WHERE id = 'ig_dm_1'").fetchone()
        assert row is not None
        assert row["platform"] == "instagram"


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
