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
