"""
Tests for the AI provider config endpoints in routers/config.py.
Uses the same TestClient fixture pattern as test_api.py.
"""

import json
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


# ── App fixture ───────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
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
        with TestClient(app) as c:
            yield c


# ── GET /api/config/providers ─────────────────────────────────────────────────

def test_get_providers_returns_list(client):
    r = client.get("/api/config/providers")
    assert r.status_code == 200
    d = r.json()
    assert "providers" in d
    assert "available_types" in d
    assert isinstance(d["providers"], list)
    assert isinstance(d["available_types"], dict)


def test_provider_types_available(client):
    r = client.get("/api/config/providers")
    assert r.status_code == 200
    available = r.json()["available_types"]
    for expected_type in ("anthropic", "openai", "groq", "gemini", "ollama", "kimi"):
        assert expected_type in available, f"'{expected_type}' missing from available_types"


# ── POST /api/config/providers ────────────────────────────────────────────────

def test_save_providers_validates_type(client):
    # A provider dict with no 'type' key must return 400
    r = client.post(
        "/api/config/providers",
        json={"providers": [{"key": "sk-fake", "enabled": True}]},
    )
    assert r.status_code == 400


def test_save_providers_preserves_empty_keys(client, tmp_path, monkeypatch):
    """
    When the frontend sends key="" for anthropic but a legacy anthropic_api_key
    exists in the config file, the server must restore the original key so it is
    not silently erased.
    """
    cfg_file = tmp_path / "app-config.json"
    legacy_key = "sk-ant-legacy-key-1234"
    cfg_file.write_text(json.dumps({"anthropic_api_key": legacy_key}))

    monkeypatch.setattr("routers.config.APP_CONFIG_PATH", cfg_file)

    r = client.post(
        "/api/config/providers",
        json={"providers": [{"type": "anthropic", "key": "", "enabled": True, "priority": 1}]},
    )
    assert r.status_code == 200

    saved = json.loads(cfg_file.read_text())
    # The legacy key must have been restored into ai_providers
    providers = saved.get("ai_providers", [])
    ant = next((p for p in providers if p.get("type") == "anthropic"), None)
    assert ant is not None, "anthropic provider not found in saved config"
    assert ant.get("key") == legacy_key, (
        f"Expected key to be preserved as '{legacy_key}', got '{ant.get('key')}'"
    )
