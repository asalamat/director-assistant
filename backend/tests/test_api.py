"""
Integration tests — spins up the FastAPI app with TestClient.
No real IMAP or AI calls are made; external services are patched.
"""

import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
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
    with patch("chromadb.PersistentClient", return_value=mock_chroma), \
         patch("services.rag_engine.SentenceTransformerEmbeddingFunction"):
        from main import app
        with TestClient(app) as c:
            yield c


# ── /health ───────────────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ── /api/stats ────────────────────────────────────────────────────────────────

def test_stats_shape(client):
    r = client.get("/api/stats")
    assert r.status_code == 200
    d = r.json()
    assert "rag" in d and "ingest" in d and "poll" in d and "accounts" in d
    assert "cached_emails" in d["rag"]
    assert "last_checked" in d["poll"]
    assert "last_error" in d["poll"]


# ── /api/config ───────────────────────────────────────────────────────────────

def test_get_config(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    d = r.json()
    assert "has_api_key" in d
    assert "has_openai_key" in d
    assert "poll_interval_seconds" in d
    assert "budget_mode" in d


def test_save_config_interval(client, tmp_path, monkeypatch):
    cfg_file = tmp_path / "app-config.json"
    monkeypatch.setattr("routers.config.APP_CONFIG_PATH", cfg_file)
    r = client.post("/api/config", json={"poll_interval_seconds": 120})
    assert r.status_code == 200
    assert r.json()["status"] == "saved"
    saved = json.loads(cfg_file.read_text())
    assert saved["poll_interval_seconds"] == 120


def test_save_config_budget_mode(client, tmp_path, monkeypatch):
    cfg_file = tmp_path / "app-config.json"
    monkeypatch.setattr("routers.config.APP_CONFIG_PATH", cfg_file)
    r = client.post("/api/config", json={"budget_mode": True})
    assert r.status_code == 200
    saved = json.loads(cfg_file.read_text())
    assert saved["budget_mode"] is True


def test_test_key_no_key(client):
    r = client.post("/api/config/test-key", json={})
    assert r.status_code == 200
    assert r.json()["valid"] is False


def test_test_key_invalid(client):
    r = client.post("/api/config/test-key", json={"anthropic_api_key": "sk-ant-fake"})
    assert r.status_code == 200
    assert r.json()["valid"] is False
    assert "error" in r.json()


def test_test_openai_key_no_key(client):
    r = client.post("/api/config/test-openai-key", json={})
    assert r.status_code == 200
    assert r.json()["valid"] is False


def test_test_openai_key_invalid(client):
    r = client.post("/api/config/test-openai-key", json={"openai_api_key": "sk-fake"})
    assert r.status_code == 200
    assert r.json()["valid"] is False


# ── /api/health/full ─────────────────────────────────────────────────────────

def test_full_health_no_imap(client):
    r = client.get("/api/health/full?check_imap=false")
    assert r.status_code == 200
    d = r.json()
    assert "overall" in d
    assert d["overall"] in ("ok", "degraded", "error")
    assert d["backend"]["status"] == "ok"
    assert "rag" in d and "database" in d and "ai" in d
    assert "anthropic" in d["ai"] and "openai" in d["ai"]
    # With no WiFi check, accounts should show not_tested
    for acc in d["accounts"]:
        assert acc["imap_status"] == "not_tested"


def test_full_health_imap_mocked(client):
    with patch("routers.health._imap_ping", return_value="ok"):
        r = client.get("/api/health/full?check_imap=true")
    assert r.status_code == 200
    d = r.json()
    for acc in d["accounts"]:
        assert acc["imap_status"] == "ok"


def test_full_health_imap_offline(client):
    with patch("routers.health._imap_ping",
               return_value="Connection timed out — no network or server unreachable"):
        r = client.get("/api/health/full?check_imap=true")
    assert r.status_code == 200
    d = r.json()
    # Overall must be error when IMAP fails
    if d["accounts"]:
        assert d["overall"] == "error"
        assert any(
            "timed out" in a["imap_status"] or a["imap_status"] != "ok"
            for a in d["accounts"]
        )


# ── /api/accounts ─────────────────────────────────────────────────────────────

def test_list_accounts(client):
    r = client.get("/api/accounts")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    for acc in r.json():
        # Passwords must always be masked
        assert acc.get("password") != acc.get("raw_password")
        if acc.get("password"):
            assert acc["password"] == "••••••"


# ── /api/poll/now ─────────────────────────────────────────────────────────────

def test_poll_now(client):
    r = client.post("/api/poll/now")
    assert r.status_code == 200
    assert r.json()["status"] == "done"


# ── /api/emails ───────────────────────────────────────────────────────────────

def test_list_emails(client):
    r = client.get("/api/emails/?limit=10")
    assert r.status_code == 200
    d = r.json()
    assert "emails" in d and "total" in d and "has_more" in d
    assert isinstance(d["emails"], list)


def test_list_emails_sort(client):
    r = client.get("/api/emails/?limit=5&sort_by=date&sort_order=desc")
    assert r.status_code == 200


def test_list_emails_search(client):
    r = client.get("/api/emails/?q=test&limit=5")
    assert r.status_code == 200


# ── /api/actions ──────────────────────────────────────────────────────────────

def test_actions_empty(client):
    r = client.get("/api/actions")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── /api/followups ────────────────────────────────────────────────────────────

def test_followups(client):
    r = client.get("/api/followups")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── /api/templates ────────────────────────────────────────────────────────────

def test_templates_roundtrip(client):
    # Create
    r = client.post("/api/templates", json={"name": "Test Template", "body": "Hello {{name}}"})
    assert r.status_code == 200
    tid = r.json()["id"]

    # List
    r = client.get("/api/templates")
    assert r.status_code == 200
    names = [t["name"] for t in r.json()]
    assert "Test Template" in names

    # Delete
    r = client.delete(f"/api/templates/{tid}")
    assert r.status_code == 200


# ── /api/analytics ────────────────────────────────────────────────────────────

def test_analytics(client):
    r = client.get("/api/analytics?days=7")
    assert r.status_code == 200
    d = r.json()
    assert "daily_volume" in d and "top_senders" in d and "total_emails" in d


# ── AI client unit tests ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ai_client_fallback():
    """Claude rate-limit → should fall back to OpenAI."""
    import anthropic
    from services.ai_client import AIClient, _OpenAIResponse

    fake_oai_resp = MagicMock()
    fake_oai_resp.choices = [MagicMock()]
    fake_oai_resp.choices[0].message.content = "OpenAI answer"
    fake_oai_resp.model = "gpt-4o-mini"

    mock_oai = AsyncMock()
    mock_oai.chat.completions.create = AsyncMock(return_value=fake_oai_resp)

    ai = AIClient(anthropic_key="sk-ant-fake", openai_key="sk-fake")
    ai._openai = mock_oai

    # Make Anthropic raise RateLimitError
    with patch.object(ai._anthropic.messages, "create",
                      side_effect=anthropic.RateLimitError(
                          "rate limit", response=MagicMock(status_code=429), body={}
                      )):
        resp = await ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=10,
            messages=[{"role": "user", "content": "hi"}]
        )

    assert resp.content[0].text == "OpenAI answer"
    assert resp.model == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_ai_client_budget_mode():
    """Budget mode must downgrade claude-sonnet → claude-haiku."""
    from services.ai_client import AIClient, _BUDGET_ANTHROPIC

    ai = AIClient(anthropic_key="sk-ant-fake", budget_mode=True)

    captured = {}

    async def fake_create(**kwargs):
        captured["model"] = kwargs["model"]
        m = MagicMock()
        m.content = [MagicMock(text="ok")]
        return m

    with patch.object(ai._anthropic.messages, "create", side_effect=fake_create):
        await ai.messages.create(
            model="claude-sonnet-4-6", max_tokens=10,
            messages=[{"role": "user", "content": "hi"}]
        )

    assert captured["model"] == _BUDGET_ANTHROPIC


@pytest.mark.asyncio
async def test_ai_client_no_providers():
    """No keys configured → raises RuntimeError."""
    from services.ai_client import AIClient
    ai = AIClient()
    with pytest.raises(RuntimeError, match="No AI provider"):
        await ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=5,
            messages=[{"role": "user", "content": "hi"}]
        )


# ── IMAP ping unit tests ──────────────────────────────────────────────────────

def test_imap_ping_timeout():
    """Unreachable host must return timeout message within ~8 seconds."""
    import time
    from routers.health import _imap_ping
    start = time.time()
    result = _imap_ping("192.0.2.1", 993, "u", "p")  # TEST-NET — always unreachable
    elapsed = time.time() - start
    assert "timed out" in result.lower() or "connection failed" in result.lower()
    assert elapsed < 12, f"Took {elapsed:.1f}s — timeout not working"


def test_imap_ping_bad_host():
    from routers.health import _imap_ping
    result = _imap_ping("", 993, "u", "p")
    assert result != "ok"


def test_imap_ping_invalid_creds():
    """Bad credentials must return an auth error (mocked — no live network call)."""
    import imaplib
    from routers.health import _imap_ping

    mock_imap = MagicMock()
    mock_imap.login.side_effect = imaplib.IMAP4.error("[AUTH] Login failed: bad credentials")

    with patch("imaplib.IMAP4_SSL", return_value=mock_imap):
        result = _imap_ping("imap.mail.yahoo.com", 993, "notauser@yahoo.com", "wrongpassword")

    assert result != "ok"
    assert "auth" in result.lower() or "failed" in result.lower()
