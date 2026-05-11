"""
SQLite-backed local email cache with FTS5 full-text search.
Eliminates repeated IMAP round-trips for list/fetch operations.
Productivity tables, analytics, and account management live in email_extras.py.
"""

import json
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import List, Optional

from models import EmailMessage, EmailSummary
from services.email_extras import EmailExtrasMixin


class EmailCache(EmailExtrasMixin):
    def __init__(self):
        db_dir = Path.home() / ".director-assistant"
        db_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = str(db_dir / "emails.db")
        self._init_db()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self):
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS emails (
                    id          TEXT PRIMARY KEY,
                    subject     TEXT DEFAULT '',
                    sender      TEXT DEFAULT '',
                    recipients  TEXT DEFAULT '[]',
                    date        TEXT,
                    body        TEXT,
                    body_html   TEXT,
                    thread_id   TEXT,
                    folder      TEXT DEFAULT 'INBOX',
                    is_read     INTEGER DEFAULT 1,
                    cached_at   TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
                    id      UNINDEXED,
                    subject,
                    sender,
                    body,
                    content='emails',
                    content_rowid='rowid'
                )
            """)
            for trigger, event, cols in [
                ("emails_ai", "INSERT", "new"),
                ("emails_au", "UPDATE", "new"),
            ]:
                conn.execute(f"""
                    CREATE TRIGGER IF NOT EXISTS {trigger}
                    AFTER {event} ON emails BEGIN
                        INSERT OR REPLACE INTO emails_fts(rowid, id, subject, sender, body)
                        VALUES ({cols}.rowid, {cols}.id, {cols}.subject, {cols}.sender, {cols}.body);
                    END
                """)
            conn.execute("""
                CREATE TRIGGER IF NOT EXISTS emails_ad
                AFTER DELETE ON emails BEGIN
                    DELETE FROM emails_fts WHERE id = old.id;
                END
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_folder_date ON emails(folder, date DESC)")

            # One-time migration: normalize folder names stored before _normalize_folder
            for old, new in [
                ("inbox", "INBOX"), ("Inbox", "INBOX"),
                ("sentitems", "Sent"), ("sent items", "Sent"), ("Sent Items", "Sent"),
                ("deleted items", "Trash"), ("deleteditems", "Trash"),
                ("junkemail", "Junk"), ("junk email", "Junk"),
            ]:
                conn.execute("UPDATE emails SET folder = ? WHERE folder = ?", (new, old))

            conn.execute("""
                CREATE TABLE IF NOT EXISTS action_items (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    email_id     TEXT NOT NULL,
                    email_subject TEXT DEFAULT '',
                    text         TEXT NOT NULL,
                    done         INTEGER DEFAULT 0,
                    created_at   TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS follow_ups (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    email_id     TEXT NOT NULL,
                    subject      TEXT DEFAULT '',
                    sender       TEXT DEFAULT '',
                    due_date     TEXT NOT NULL,
                    note         TEXT DEFAULT '',
                    done         INTEGER DEFAULT 0,
                    created_at   TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS templates (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    name         TEXT NOT NULL,
                    body         TEXT NOT NULL,
                    created_at   TEXT DEFAULT (datetime('now')),
                    updated_at   TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS email_categories (
                    email_id     TEXT PRIMARY KEY,
                    category     TEXT NOT NULL,
                    classified_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS accounts (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    name         TEXT DEFAULT '',
                    provider     TEXT NOT NULL,
                    username     TEXT NOT NULL,
                    config_json  TEXT DEFAULT '{}',
                    active       INTEGER DEFAULT 1,
                    last_ingested TEXT,
                    created_at   TEXT DEFAULT (datetime('now'))
                )
            """)
            for col_def in ["account_id INTEGER DEFAULT 0", "server_id TEXT"]:
                try:
                    conn.execute(f"ALTER TABLE emails ADD COLUMN {col_def}")
                except Exception:
                    pass

    # Canonical names for well-known folders so case-inconsistent providers
    # (Office365 returns "inbox"/"sentitems", IMAP returns "INBOX") all map
    # to the same value.
    _FOLDER_MAP = {
        "inbox": "INBOX",
        "sentitems": "Sent",
        "sent items": "Sent",
        "sent": "Sent",
        "drafts": "Drafts",
        "trash": "Trash",
        "deleted items": "Trash",
        "deleteditems": "Trash",
        "junk": "Junk",
        "junkemail": "Junk",
        "spam": "Junk",
    }

    def _normalize_folder(self, folder: str) -> str:
        return self._FOLDER_MAP.get(folder.strip().lower(), folder)

    def _email_to_row(self, email: EmailMessage, account_id: int = 0) -> tuple:
        return (
            email.id,
            email.subject or "",
            email.sender or "",
            json.dumps(email.recipients),
            str(email.date) if email.date else None,
            email.body,
            email.body_html,
            email.thread_id,
            self._normalize_folder(email.folder or "INBOX"),
            1 if email.is_read else 0,
            account_id,
            email.server_id or email.id,
        )

    def save(self, email: EmailMessage, account_id: int = 0) -> bool:
        """Upsert single email. Returns True if newly inserted."""
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT id FROM emails WHERE id = ?", (email.id,)
            ).fetchone()
            conn.execute(
                """INSERT OR REPLACE INTO emails
                   (id, subject, sender, recipients, date, body, body_html,
                    thread_id, folder, is_read, account_id, server_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                self._email_to_row(email, account_id),
            )
        return existing is None

    def save_batch(self, emails: List[EmailMessage], account_id: int = 0) -> int:
        """Bulk upsert using executemany. Returns count of new rows."""
        if not emails:
            return 0
        rows = [self._email_to_row(e, account_id) for e in emails]
        with self._conn() as conn:
            existing_ids = {
                r[0] for r in conn.execute(
                    f"SELECT id FROM emails WHERE id IN ({','.join('?' * len(emails))})",
                    [e.id for e in emails],
                ).fetchall()
            }
            conn.executemany(
                """INSERT OR REPLACE INTO emails
                   (id, subject, sender, recipients, date, body, body_html,
                    thread_id, folder, is_read, account_id, server_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )
        return sum(1 for e in emails if e.id not in existing_ids)

    def get(self, email_id: str) -> Optional[EmailMessage]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM emails WHERE id = ?", (email_id,)
            ).fetchone()
        return self._to_message(dict(row)) if row else None

    SORT_COLS = {"date": "date", "sender": "sender", "subject": "subject"}

    def list_emails(
        self,
        folder: str = "INBOX",
        skip: int = 0,
        limit: int = 50,
        sort_by: str = "date",
        sort_order: str = "desc",
        from_date: Optional[str] = None,
        account_id: Optional[int] = None,
    ) -> tuple[list[EmailSummary], int]:
        col = self.SORT_COLS.get(sort_by, "date")
        direction = "ASC" if sort_order.lower() == "asc" else "DESC"
        normalized = self._normalize_folder(folder)
        where = "UPPER(folder) = UPPER(?)"
        params: list = [normalized]

        if from_date:
            where += " AND date >= ?"
            params.append(from_date)

        if account_id is not None:
            where += " AND account_id = ?"
            params.append(account_id)

        with self._conn() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM emails WHERE {where}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"""SELECT id, subject, sender, date, body, is_read
                    FROM emails WHERE {where}
                    ORDER BY {col} {direction} LIMIT ? OFFSET ?""",
                params + [limit, skip],
            ).fetchall()
        return [self._row_to_summary(dict(r)) for r in rows], total

    def fts_search(self, query: str, limit: int = 30) -> list[EmailSummary]:
        """Full-text search via FTS5. Strips operators to avoid parse errors."""
        safe = re.sub(r'[^\w\s]', ' ', query)
        safe = ' '.join(safe.split()[:20])
        if not safe:
            return []
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT e.id, e.subject, e.sender, e.date, e.body, e.is_read
                       FROM emails e
                       JOIN emails_fts ON emails_fts.id = e.id
                       WHERE emails_fts MATCH ?
                       ORDER BY rank LIMIT ?""",
                    (safe, limit),
                ).fetchall()
            return [self._row_to_summary(dict(r)) for r in rows]
        except Exception:
            return []

    def count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0]

    def get_cached_server_ids(self, account_id: int, folder: str, since_str: str) -> dict:
        """Return {server_id: cache_id} for emails in this account/folder since a date."""
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT id, server_id FROM emails
                   WHERE account_id = ? AND UPPER(folder) = UPPER(?) AND date >= ?""",
                (account_id, folder, since_str),
            ).fetchall()
        return {r["server_id"]: r["id"] for r in rows if r["server_id"]}

    def delete_email(self, email_id: str) -> bool:
        """Remove email and its FTS entry. Returns True if it existed."""
        with self._conn() as conn:
            deleted = conn.execute(
                "DELETE FROM emails WHERE id = ?", (email_id,)
            ).rowcount
            conn.execute("DELETE FROM emails_fts WHERE id = ?", (email_id,))
            conn.execute("DELETE FROM action_items WHERE email_id = ?", (email_id,))
        return deleted > 0

    def _to_message(self, row: dict) -> EmailMessage:
        try:
            recipients = json.loads(row.get("recipients") or "[]")
        except Exception:
            recipients = []
        return EmailMessage(
            id=row["id"],
            subject=row.get("subject") or "",
            sender=row.get("sender") or "",
            recipients=recipients,
            date=row.get("date"),
            body=row.get("body"),
            body_html=row.get("body_html"),
            thread_id=row.get("thread_id"),
            folder=row.get("folder") or "INBOX",
            is_read=bool(row.get("is_read", 1)),
        )

    def _row_to_summary(self, row: dict) -> EmailSummary:
        return EmailSummary(
            id=row["id"],
            subject=row.get("subject") or "(no subject)",
            sender=row.get("sender") or "",
            date=row.get("date"),
            preview=((row.get("body") or "")[:160]).replace("\n", " "),
            is_read=bool(row.get("is_read", 1)),
        )
