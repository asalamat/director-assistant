"""
Tests for the email_list.py router endpoints.
Uses the same TestClient fixture pattern as test_api.py.
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from cachetools import TTLCache


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


# ── /api/emails/ ──────────────────────────────────────────────────────────────

def test_list_emails_returns_200(client):
    r = client.get("/api/emails/?folder=INBOX")
    assert r.status_code == 200
    d = r.json()
    assert "emails" in d
    assert "total" in d
    assert "has_more" in d
    assert isinstance(d["emails"], list)
    assert isinstance(d["total"], int)
    assert isinstance(d["has_more"], bool)


def test_list_emails_only_unread(client):
    r = client.get("/api/emails/?only_unread=true")
    assert r.status_code == 200
    d = r.json()
    assert "emails" in d
    # Any returned emails must have is_read == False
    for email in d["emails"]:
        assert email.get("is_read") is False


# ── /api/emails/{email_id} ────────────────────────────────────────────────────

def test_get_email_not_found(client):
    r = client.get("/api/emails/nonexistent_id_xyz")
    assert r.status_code == 404


def test_delete_email_not_found(client):
    r = client.delete("/api/emails/nonexistent_id")
    assert r.status_code == 404


# ── /api/emails/folders ───────────────────────────────────────────────────────

def test_list_folders(client):
    r = client.get("/api/emails/folders")
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


# ── /api/emails/unread-count ──────────────────────────────────────────────────

def test_unread_count(client):
    r = client.get("/api/emails/unread-count")
    assert r.status_code == 200
    d = r.json()
    assert "unread" in d
    assert isinstance(d["unread"], int)


# ── /api/emails/threads ───────────────────────────────────────────────────────

def test_threads(client):
    r = client.get("/api/emails/threads")
    assert r.status_code == 200
    d = r.json()
    assert "threads" in d
    assert isinstance(d["threads"], list)


# ── /api/emails/followup-due ──────────────────────────────────────────────────

def test_followup_due(client):
    r = client.get("/api/emails/followup-due")
    assert r.status_code == 200
    d = r.json()
    assert "emails" in d
    assert isinstance(d["emails"], list)


# ── TTLCache module-level attribute ──────────────────────────────────────────

def test_email_list_rec_cache_is_ttlcache():
    from routers.email_list import _rec_cache
    assert isinstance(_rec_cache, TTLCache)
    assert _rec_cache.maxsize == 500
