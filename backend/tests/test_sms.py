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
