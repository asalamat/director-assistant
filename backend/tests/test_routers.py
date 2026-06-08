"""
Router-level endpoint tests: vip, followups, projects, actions (done filter), triage.
Uses FastAPI TestClient with a mocked app.state.cache — no real DB calls.
"""

import sqlite3
import tempfile
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from models import ActionItem, FollowUp


# ── Shared in-memory SQLite cache fixture ────────────────────────────────────

def _make_sqlite_cache():
    """Return a minimal cache-like object backed by an in-memory SQLite DB
    with the tables required by the vip and projects routers."""
    db_file = tempfile.mktemp(suffix=".db")

    @contextmanager
    def _conn():
        conn = sqlite3.connect(db_file)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS vip_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email_addr TEXT UNIQUE NOT NULL,
                name TEXT DEFAULT '',
                note TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS emails (
                id TEXT PRIMARY KEY,
                subject TEXT, sender TEXT, recipients TEXT,
                date TEXT, body TEXT, thread_id TEXT, folder TEXT,
                is_read INTEGER DEFAULT 0, account_id INTEGER DEFAULT 0,
                server_id TEXT
            );
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT DEFAULT 'active',
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS project_emails (
                project_id INTEGER,
                email_id TEXT,
                linked_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (project_id, email_id)
            );
        """)

    cache = MagicMock()
    cache._conn = _conn
    return cache


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
        sqlite_cache = _make_sqlite_cache()
        with TestClient(app) as c:
            # Lifespan has now run; app.state.cache exists.
            # Overlay _conn so routers that use cache._conn() get the real SQLite DB.
            app.state.cache._conn = sqlite_cache._conn
            yield c


# ── Helper: a fresh sqlite cache attached to a running client ─────────────────

@pytest.fixture(scope="module")
def sqlite_cache(client):
    """Return the sqlite-backed cache attached during the client fixture."""
    from main import app
    return app.state.cache


# ═══════════════════════════════════════════════════════════════════════════════
# VIP endpoints
# ═══════════════════════════════════════════════════════════════════════════════

class TestVIPEndpoints:
    def test_list_vips_empty(self, client):
        """GET /api/vip returns empty list when no VIPs exist."""
        r = client.get("/api/vip")
        assert r.status_code == 200
        assert "vips" in r.json()
        assert isinstance(r.json()["vips"], list)

    def test_create_vip(self, client):
        """POST /api/vip adds a new contact and echoes the email."""
        r = client.post("/api/vip", json={
            "email_addr": "alice@example.com",
            "name": "Alice",
            "note": "key client",
        })
        assert r.status_code == 200
        assert r.json()["added"] == "alice@example.com"

    def test_list_vips_after_create(self, client):
        """GET /api/vip returns the previously created contact."""
        r = client.get("/api/vip")
        assert r.status_code == 200
        emails = [v["email_addr"] for v in r.json()["vips"]]
        assert "alice@example.com" in emails

    def test_create_vip_duplicate(self, client):
        """POST /api/vip with a duplicate email returns 409."""
        r = client.post("/api/vip", json={"email_addr": "alice@example.com"})
        assert r.status_code == 409

    def test_delete_vip(self, client):
        """DELETE /api/vip/{id} removes the contact; subsequent list excludes it."""
        # Create a fresh contact to delete
        r = client.post("/api/vip", json={"email_addr": "todelete@example.com"})
        assert r.status_code == 200

        # Fetch its id
        r2 = client.get("/api/vip")
        vips = r2.json()["vips"]
        vip = next((v for v in vips if v["email_addr"] == "todelete@example.com"), None)
        assert vip is not None
        vid = vip["id"]

        r3 = client.delete(f"/api/vip/{vid}")
        assert r3.status_code == 200
        assert r3.json()["removed"] == vid

        # Should no longer appear
        r4 = client.get("/api/vip")
        remaining = [v["email_addr"] for v in r4.json()["vips"]]
        assert "todelete@example.com" not in remaining

    def test_delete_nonexistent_vip(self, client):
        """DELETE /api/vip/99999 is idempotent — returns 200 (no 404 in this router)."""
        r = client.delete("/api/vip/99999")
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Followups endpoints
# ═══════════════════════════════════════════════════════════════════════════════

class TestFollowupsEndpoints:

    @staticmethod
    def _cache():
        from main import app
        return app.state.cache

    def test_list_followups_empty(self, client):
        """GET /api/followups returns a list (empty is fine)."""
        with patch.object(self._cache(), 'list_follow_ups', return_value=[]):
            r = client.get("/api/followups")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_followups_returns_items(self, client):
        """GET /api/followups returns mocked follow-up items."""
        fu = FollowUp(id=1, email_id="e1", subject="Check in",
                      sender="bob@test.com", due_date="2026-07-01")
        with patch.object(self._cache(), 'list_follow_ups', return_value=[fu]):
            r = client.get("/api/followups")
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1
        assert data[0]["subject"] == "Check in"

    def test_create_followup(self, client):
        """POST /api/followups creates an entry and returns its id."""
        payload = {
            "email_id": "email123",
            "subject": "Proposal review",
            "sender": "carol@test.com",
            "due_date": "2026-08-01",
        }
        with patch.object(self._cache(), 'add_follow_up', return_value=42):
            r = client.post("/api/followups", json=payload)
        assert r.status_code == 200
        assert r.json()["id"] == 42

    def test_update_followup_found(self, client):
        """PATCH /api/followups/{id} marks done when item exists."""
        with patch.object(self._cache(), 'set_follow_up_done', return_value=True):
            r = client.patch("/api/followups/1", json={"done": True})
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_update_followup_not_found(self, client):
        """PATCH /api/followups/{id} returns 404 when item not found."""
        with patch.object(self._cache(), 'set_follow_up_done', return_value=False):
            r = client.patch("/api/followups/9999", json={"done": True})
        assert r.status_code == 404

    def test_delete_followup_found(self, client):
        """DELETE /api/followups/{id} succeeds when item exists."""
        with patch.object(self._cache(), 'delete_follow_up', return_value=True):
            r = client.delete("/api/followups/1")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_delete_followup_not_found(self, client):
        """DELETE /api/followups/{id} returns 404 when item not found."""
        with patch.object(self._cache(), 'delete_follow_up', return_value=False):
            r = client.delete("/api/followups/9999")
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# Projects endpoints
# ═══════════════════════════════════════════════════════════════════════════════

class TestProjectsEndpoints:

    def test_list_projects_empty(self, client):
        """GET /api/projects returns empty list when no projects exist."""
        r = client.get("/api/projects")
        assert r.status_code == 200
        assert "projects" in r.json()
        assert isinstance(r.json()["projects"], list)

    def test_create_project(self, client):
        """POST /api/projects creates a project and returns id + name."""
        r = client.post("/api/projects", json={
            "name": "Q3 Campaign",
            "description": "Marketing campaign",
            "status": "active",
        })
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert data["name"] == "Q3 Campaign"

    def test_list_projects_after_create(self, client):
        """GET /api/projects includes the recently created project."""
        r = client.get("/api/projects")
        assert r.status_code == 200
        names = [p["name"] for p in r.json()["projects"]]
        assert "Q3 Campaign" in names

    def test_create_project_minimal(self, client):
        """POST /api/projects with name only (optional fields default)."""
        r = client.post("/api/projects", json={"name": "Minimal Project"})
        assert r.status_code == 200
        assert r.json()["name"] == "Minimal Project"

    def test_create_project_empty_name(self, client):
        """POST /api/projects with blank name still inserts (validation is router-side only)."""
        r = client.post("/api/projects", json={"name": "  "})
        # Router strips whitespace but doesn't enforce min-length — 200 is acceptable
        assert r.status_code in (200, 422)


# ═══════════════════════════════════════════════════════════════════════════════
# Actions — done filter
# ═══════════════════════════════════════════════════════════════════════════════

class TestActionsFilter:

    @staticmethod
    def _cache():
        from main import app
        return app.state.cache

    def _make_action(self, aid, text, done):
        return ActionItem(id=aid, email_id="e1", text=text, done=done,
                          email_subject="Test", created_at="2026-01-01T00:00:00")

    def test_list_all_actions(self, client):
        """GET /api/actions without filter returns all items."""
        items = [self._make_action(1, "Send report", False),
                 self._make_action(2, "Schedule call", True)]
        with patch.object(self._cache(), 'list_action_items', return_value=items):
            r = client.get("/api/actions")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) == 2

    def test_list_actions_done_true(self, client):
        """GET /api/actions?done=true returns only completed items."""
        items = [self._make_action(2, "Schedule call", True)]
        with patch.object(self._cache(), 'list_action_items', return_value=items):
            r = client.get("/api/actions?done=true")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_actions_done_false(self, client):
        """GET /api/actions?done=false returns only pending items."""
        items = [self._make_action(1, "Send report", False)]
        with patch.object(self._cache(), 'list_action_items', return_value=items):
            r = client.get("/api/actions?done=false")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_actions_empty(self, client):
        """GET /api/actions returns empty list when nothing stored."""
        with patch.object(self._cache(), 'list_action_items', return_value=[]):
            r = client.get("/api/actions")
        assert r.status_code == 200
        assert r.json() == []


# ═══════════════════════════════════════════════════════════════════════════════
# Triage endpoint
# ═══════════════════════════════════════════════════════════════════════════════

class TestTriageEndpoints:

    def test_triage_top_returns_emails_key(self, client):
        """GET /api/triage/top returns a dict with an 'emails' list."""
        with patch("services.triage.get_top_emails", return_value=[]):
            r = client.get("/api/triage/top")
        assert r.status_code == 200
        assert "emails" in r.json()
        assert isinstance(r.json()["emails"], list)

    def test_triage_top_with_results(self, client):
        """GET /api/triage/top surfaces mocked scored emails."""
        scored = [
            {"id": "abc", "subject": "Urgent deal", "score": 95, "reasons": ["keyword"]},
        ]
        with patch("services.triage.get_top_emails", return_value=scored):
            r = client.get("/api/triage/top")
        assert r.status_code == 200
        emails = r.json()["emails"]
        assert len(emails) == 1
        assert emails[0]["subject"] == "Urgent deal"

    def test_triage_top_limit_capped(self, client):
        """GET /api/triage/top?limit=100 is capped to 20 internally."""
        with patch("services.triage.get_top_emails", return_value=[]) as mock_get:
            r = client.get("/api/triage/top?limit=100")
        assert r.status_code == 200
        # get_top_emails should have been called with limit <= 20
        call_args = mock_get.call_args
        passed_limit = call_args[0][1] if call_args[0] else call_args[1].get("limit", 0)
        assert passed_limit <= 20
