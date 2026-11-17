"""run-now endpoint: isolated temp DB, never touches the real autopilot."""
import sqlite3
from contextlib import contextmanager
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers import social


class FakeCache:
    def __init__(self, path):
        self.path = path

    @contextmanager
    def _conn(self):
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()


def _client(tmp_path):
    app = FastAPI()
    app.include_router(social.router)
    app.state.cache = FakeCache(str(tmp_path / "t.db"))
    social._ensure_tables(app.state.cache)
    return TestClient(app), app.state.cache


def test_run_now_404_when_not_configured(tmp_path):
    c, _ = _client(tmp_path)
    r = c.post("/api/social/linkedin/autopilot/run-now")
    assert r.status_code == 404 and r.json()["detail"] == "Autopilot not configured"


def test_run_now_enables_and_sets_due(tmp_path):
    c, cache = _client(tmp_path)
    with cache._conn() as conn:
        conn.execute("INSERT INTO linkedin_autopilot (topics, enabled, next_post_at) VALUES ('[\"a\"]', 0, '2026-11-15T09:00')")
    r = c.post("/api/social/linkedin/autopilot/run-now")
    assert r.status_code == 200
    with cache._conn() as conn:
        row = conn.execute("SELECT enabled, next_post_at FROM linkedin_autopilot").fetchone()
    assert row["enabled"] == 1
    assert row["next_post_at"] == r.json()["next_post_at"] > "2026-11-15T09:00"
