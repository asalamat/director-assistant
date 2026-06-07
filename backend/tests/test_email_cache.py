"""Unit tests for EmailCache core operations."""
import json
import sqlite3
import tempfile
import os
import pytest
from unittest.mock import patch


@pytest.fixture
def cache():
    """EmailCache backed by a temp SQLite file, cleaned up after each test."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    with patch.object(
        __import__("services.email_cache", fromlist=["EmailCache"]).EmailCache,
        "__init__",
        lambda self: setattr(self, "db_path", db_path) or
            __import__("services.email_cache", fromlist=["EmailCache"]).EmailCache._init_db(self)
    ):
        from services.email_cache import EmailCache
        c = EmailCache.__new__(EmailCache)
        c.db_path = db_path
        c._init_db()
        yield c
    os.unlink(db_path)


@pytest.fixture
def cache2():
    """Simpler fixture — just use a real EmailCache with a temp path."""
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from services.email_cache import EmailCache
    from pathlib import Path
    import tempfile
    tmp = tempfile.mkdtemp()
    with patch.object(Path, "home", return_value=Path(tmp)):
        c = EmailCache()
    yield c
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def simple_cache(tmp_path):
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from services.email_cache import EmailCache
    from unittest.mock import patch
    from pathlib import Path
    with patch("pathlib.Path.home", return_value=tmp_path):
        c = EmailCache()
    return c


def make_email(id="test1", subject="Hello", sender="alice@example.com",
               body="Test body", folder="INBOX", is_read=True, date="2026-06-05"):
    from models import EmailMessage
    return EmailMessage(
        id=id, subject=subject, sender=sender,
        recipients=["bob@example.com"], date=date,
        body=body, body_html=None, thread_id=None,
        folder=folder, is_read=is_read,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestSaveAndGet:
    def test_save_and_retrieve(self, simple_cache):
        email = make_email(id="e1", subject="Test Email")
        simple_cache.save(email)
        result = simple_cache.get("e1")
        assert result is not None
        assert result.subject == "Test Email"
        assert result.sender == "alice@example.com"
        assert result.folder == "INBOX"

    def test_get_missing_returns_none(self, simple_cache):
        assert simple_cache.get("nonexistent_id") is None

    def test_save_updates_existing(self, simple_cache):
        email = make_email(id="e1", subject="Original")
        simple_cache.save(email)
        email2 = make_email(id="e1", subject="Updated")
        simple_cache.save(email2)
        result = simple_cache.get("e1")
        assert result.subject == "Updated"


class TestListEmails:
    def test_list_by_folder(self, simple_cache):
        simple_cache.save(make_email(id="i1", folder="INBOX", date="2026-06-01"))
        simple_cache.save(make_email(id="s1", folder="Sent", date="2026-06-01"))
        inbox, _ = simple_cache.list_emails(folder="INBOX")
        assert any(e.id == "i1" for e in inbox)
        assert not any(e.id == "s1" for e in inbox)

    def test_list_only_unread(self, simple_cache):
        simple_cache.save(make_email(id="u1", is_read=False, folder="INBOX", date="2026-06-01"))
        simple_cache.save(make_email(id="r1", is_read=True, folder="INBOX", date="2026-06-01"))
        simple_cache.save(make_email(id="u2", is_read=False, folder="Archive", date="2026-06-01"))
        results, total = simple_cache.list_emails(only_unread=True)
        ids = [e.id for e in results]
        assert "u1" in ids
        assert "u2" in ids  # cross-folder
        assert "r1" not in ids
        assert total == 2

    def test_pagination(self, simple_cache):
        for i in range(5):
            simple_cache.save(make_email(id=f"p{i}", date=f"2026-06-0{i+1}"))
        page1, total = simple_cache.list_emails(skip=0, limit=3)
        page2, _ = simple_cache.list_emails(skip=3, limit=3)
        assert len(page1) == 3
        assert len(page2) == 2
        assert total == 5


class TestUnreadCount:
    def test_count_unread(self, simple_cache):
        simple_cache.save(make_email(id="u1", is_read=False, date="2026-06-01"))
        simple_cache.save(make_email(id="u2", is_read=False, date="2026-06-01"))
        simple_cache.save(make_email(id="r1", is_read=True, date="2026-06-01"))
        assert simple_cache.count_unread() == 2

    def test_count_zero_initially(self, simple_cache):
        assert simple_cache.count_unread() == 0


class TestFTSSearch:
    def test_finds_by_subject(self, simple_cache):
        simple_cache.save(make_email(id="f1", subject="Invoice Q3 payment", date="2026-06-01"))
        simple_cache.save(make_email(id="f2", subject="Meeting notes", date="2026-06-01"))
        results = simple_cache.fts_search("invoice")
        assert any(e.id == "f1" for e in results)
        assert not any(e.id == "f2" for e in results)

    def test_finds_by_body(self, simple_cache):
        simple_cache.save(make_email(id="b1", body="Please review the contract renewal terms", date="2026-06-01"))
        results = simple_cache.fts_search("contract renewal")
        assert any(e.id == "b1" for e in results)

    def test_empty_query_returns_empty(self, simple_cache):
        simple_cache.save(make_email(id="e1", date="2026-06-01"))
        results = simple_cache.fts_search("")
        assert results == []


class TestVIPContacts:
    def test_vip_crud(self, simple_cache):
        # Add VIP
        with simple_cache._conn() as conn:
            conn.execute("INSERT INTO vip_contacts (email_addr, name, note) VALUES (?,?,?)",
                        ("vip@example.com", "Important Person", "CEO"))
        # List
        with simple_cache._conn() as conn:
            rows = conn.execute("SELECT * FROM vip_contacts").fetchall()
        assert len(rows) == 1
        assert rows[0]["email_addr"] == "vip@example.com"
        # Remove
        with simple_cache._conn() as conn:
            conn.execute("DELETE FROM vip_contacts WHERE email_addr = ?", ("vip@example.com",))
        with simple_cache._conn() as conn:
            rows = conn.execute("SELECT * FROM vip_contacts").fetchall()
        assert len(rows) == 0


class TestProjects:
    def test_project_create_and_link(self, simple_cache):
        # Create project
        with simple_cache._conn() as conn:
            cur = conn.execute("INSERT INTO projects (name, description, status) VALUES (?,?,?)",
                              ("Test Project", "A project", "active"))
            pid = cur.lastrowid
        # Save and link email
        simple_cache.save(make_email(id="proj_email", date="2026-06-01"))
        with simple_cache._conn() as conn:
            conn.execute("INSERT INTO project_emails (project_id, email_id) VALUES (?,?)", (pid, "proj_email"))
        # Verify link
        with simple_cache._conn() as conn:
            row = conn.execute("SELECT * FROM project_emails WHERE project_id=? AND email_id=?",
                              (pid, "proj_email")).fetchone()
        assert row is not None
        # Unlink
        with simple_cache._conn() as conn:
            conn.execute("DELETE FROM project_emails WHERE project_id=? AND email_id=?", (pid, "proj_email"))
        with simple_cache._conn() as conn:
            row = conn.execute("SELECT * FROM project_emails WHERE project_id=? AND email_id=?",
                              (pid, "proj_email")).fetchone()
        assert row is None


class TestDeleteEmail:
    def test_delete_removes_email(self, simple_cache):
        simple_cache.save(make_email(id="del1", date="2026-06-01"))
        assert simple_cache.get("del1") is not None
        simple_cache.delete_email("del1")
        assert simple_cache.get("del1") is None

    def test_delete_nonexistent_returns_false(self, simple_cache):
        result = simple_cache.delete_email("never_existed")
        assert result is False
