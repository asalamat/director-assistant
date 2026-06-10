"""
SQLite-backed local email cache with FTS5 full-text search.
Eliminates repeated IMAP round-trips for list/fetch operations.
Productivity tables, analytics, and account management live in email_extras.py.
"""

import json
import logging
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

from models import EmailMessage, EmailSummary
from services.email_extras import EmailExtrasMixin
from services.email_cache_docs import DocumentCacheMixin


class EmailCache(EmailExtrasMixin, DocumentCacheMixin):
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
        conn.execute("PRAGMA cache_size=-32000")       # 32 MB page cache
        conn.execute("PRAGMA mmap_size=268435456")     # 256 MB memory-mapped I/O
        conn.execute("PRAGMA temp_store=MEMORY")       # temp tables in RAM
        conn.execute("PRAGMA optimize")                # lightweight planner stats refresh
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
                    account_id  INTEGER DEFAULT 0,
                    server_id   TEXT,
                    followup_remind_at TEXT,
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
            # Always recreate the delete trigger — old version used incorrect
            # "DELETE FROM emails_fts" which corrupts FTS5 content tables.
            # The correct form uses FTS5's 'delete' command.
            conn.execute("DROP TRIGGER IF EXISTS emails_ad")
            conn.execute("""
                CREATE TRIGGER emails_ad
                AFTER DELETE ON emails BEGIN
                    INSERT INTO emails_fts(emails_fts, rowid, id, subject, sender, body)
                    VALUES('delete', old.rowid, old.id,
                           COALESCE(old.subject,''), COALESCE(old.sender,''), COALESCE(old.body,''));
                END
            """)
            # Rebuild FTS5 index if corrupt (missing rows from old bad trigger)
            try:
                conn.execute("SELECT COUNT(*) FROM emails_fts WHERE emails_fts MATCH 'test'").fetchone()
            except Exception:
                conn.execute("INSERT INTO emails_fts(emails_fts) VALUES('rebuild')")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_folder_date         ON emails(folder, date DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_account_date         ON emails(account_id, date DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_account_folder_date  ON emails(account_id, folder, date DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_date                 ON emails(date DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sender               ON emails(sender)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_is_read              ON emails(is_read, date DESC) WHERE is_read = 0")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS documents_fts_store (
                    doc_id      TEXT PRIMARY KEY,
                    filename    TEXT DEFAULT '',
                    file_type   TEXT DEFAULT '',
                    file_path   TEXT DEFAULT '',
                    modified_at TEXT DEFAULT '',
                    body        TEXT DEFAULT ''
                )
            """)
            conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                    doc_id  UNINDEXED,
                    filename,
                    body,
                    content='documents_fts_store',
                    content_rowid='rowid'
                )
            """)

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
            conn.execute("CREATE INDEX IF NOT EXISTS idx_followups_done_due   ON follow_ups(done, due_date)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_action_items_email   ON action_items(email_id)")
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
            conn.execute("""
                CREATE TABLE IF NOT EXISTS email_snooze (
                    email_id   TEXT PRIMARY KEY,
                    wake_date  TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS saved_searches (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    name       TEXT NOT NULL,
                    query      TEXT NOT NULL,
                    folder     TEXT DEFAULT 'INBOX',
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS triage_rules (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    rule       TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ask_history (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp    TEXT DEFAULT (datetime('now')),
                    question     TEXT NOT NULL,
                    answer       TEXT NOT NULL,
                    results_json TEXT DEFAULT '[]'
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS scheduled_sends (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER DEFAULT 0,
                    to_addr TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    body TEXT NOT NULL,
                    send_at TEXT NOT NULL,
                    sent INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS vip_contacts (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    email_addr TEXT NOT NULL UNIQUE,
                    name       TEXT DEFAULT '',
                    note       TEXT DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS imported_contacts (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    email_addr TEXT NOT NULL UNIQUE,
                    name       TEXT DEFAULT '',
                    phones     TEXT DEFAULT '[]',
                    source     TEXT DEFAULT 'vcard',
                    imported_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS hidden_contacts (
                    email_addr TEXT NOT NULL PRIMARY KEY,
                    hidden_at  TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS meeting_recordings (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at TEXT DEFAULT (datetime('now')),
                    duration_secs INTEGER DEFAULT 0,
                    transcript  TEXT DEFAULT '',
                    action_items TEXT DEFAULT '[]',
                    draft_email TEXT DEFAULT '',
                    title       TEXT DEFAULT ''
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    status      TEXT DEFAULT 'active',
                    created_at  TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS project_emails (
                    project_id INTEGER NOT NULL,
                    email_id   TEXT NOT NULL,
                    linked_at  TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (project_id, email_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS crm_deals (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    name          TEXT NOT NULL,
                    contact_email TEXT DEFAULT '',
                    stage         TEXT DEFAULT 'prospect',
                    value         TEXT DEFAULT '',
                    notes         TEXT DEFAULT '',
                    created_at    TEXT DEFAULT (datetime('now')),
                    updated_at    TEXT DEFAULT (datetime('now'))
                )
            """)
            try:
                conn.execute("CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_crm_deals_contact ON crm_deals(contact_email)")
            except Exception:
                pass
            conn.execute("""
                CREATE TABLE IF NOT EXISTS crm_deal_history (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    deal_id    INTEGER NOT NULL,
                    changed_at TEXT DEFAULT (datetime('now')),
                    from_stage TEXT DEFAULT '',
                    to_stage   TEXT NOT NULL,
                    note       TEXT DEFAULT ''
                )
            """)
            for col_def in ["account_id INTEGER DEFAULT 0", "server_id TEXT",
                             "followup_remind_at TEXT"]:
                try:
                    conn.execute(f"ALTER TABLE emails ADD COLUMN {col_def}")
                except Exception:
                    pass
            # Add note column to imported_contacts if missing (migration)
            try:
                conn.execute("ALTER TABLE imported_contacts ADD COLUMN note TEXT DEFAULT ''")
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
        only_unread: bool = False,
        category: Optional[str] = None,
    ) -> tuple[list[EmailSummary], int]:
        col = self.SORT_COLS.get(sort_by, "date")
        direction = "ASC" if sort_order.lower() == "asc" else "DESC"

        if only_unread:
            # Cross-folder unread query — ignores folder/account filter
            where = "is_read = 0"
            params: list = []
        elif account_id is not None:
            # Show all folders for a specific account
            where = "account_id = ?"
            params = [account_id]
        else:
            normalized = self._normalize_folder(folder)
            where = "folder = ?"   # data is normalized on insert — direct compare uses index
            params = [normalized]

        if from_date:
            where += " AND date >= ?"
            params.append(from_date)

        if category:
            where += " AND id IN (SELECT email_id FROM email_categories WHERE category = ?)"
            params.append(category)

        # Exclude snoozed emails whose wake date hasn't arrived yet
        where += " AND id NOT IN (SELECT email_id FROM email_snooze WHERE wake_date > date('now'))"

        with self._conn() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM emails WHERE {where}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"""SELECT e.id, e.subject, e.sender, e.date, e.body, e.is_read,
                           ec.category
                    FROM emails e
                    LEFT JOIN email_categories ec ON ec.email_id = e.id
                    WHERE {where}
                    ORDER BY e.{col} {direction} LIMIT ? OFFSET ?""",
                params + [limit, skip],
            ).fetchall()
        return [self._row_to_summary(dict(r)) for r in rows], total

    def list_threads(
        self,
        folder: str = "INBOX",
        skip: int = 0,
        limit: int = 50,
        account_id: Optional[int] = None,
    ) -> list[dict]:
        """Return emails grouped by thread_id, newest thread first."""
        if account_id is not None:
            where = "account_id = ?"
            params: list = [account_id]
        else:
            normalized = self._normalize_folder(folder)
            where = "folder = ?"
            params = [normalized]

        where += " AND id NOT IN (SELECT email_id FROM email_snooze WHERE wake_date > date('now'))"

        with self._conn() as conn:
            # Step 1: get the paginated list of distinct thread IDs at the SQL level
            tid_rows = conn.execute(
                f"""SELECT COALESCE(thread_id, id) AS tid, MAX(date) AS max_date
                    FROM emails WHERE {where}
                    GROUP BY tid ORDER BY max_date DESC
                    LIMIT ? OFFSET ?""",
                params + [limit, skip],
            ).fetchall()

            if not tid_rows:
                return []

            tids = [r["tid"] for r in tid_rows]
            placeholders = ",".join("?" * len(tids))

            # Step 2: fetch all messages for those threads (small set)
            msg_rows = conn.execute(
                f"""SELECT id, subject, sender, date, body, is_read, thread_id
                    FROM emails
                    WHERE COALESCE(thread_id, id) IN ({placeholders})
                    ORDER BY date DESC""",
                tids,
            ).fetchall()

        # Group in Python (bounded by limit × avg thread size — not full table)
        threads: dict[str, list[dict]] = {r["tid"]: [] for r in tid_rows}
        for row in msg_rows:
            d = dict(row)
            tid = d.get("thread_id") or d["id"]
            if tid in threads:
                threads[tid].append({
                    "id": d["id"],
                    "subject": d.get("subject") or "(no subject)",
                    "sender": d.get("sender") or "",
                    "date": d.get("date"),
                    "preview": ((d.get("body") or "")[:160]).replace("\n", " "),
                    "is_read": bool(d.get("is_read", 1)),
                })

        result = []
        for r in tid_rows:
            tid = r["tid"]
            msgs = threads.get(tid, [])
            if not msgs:
                continue
            result.append({
                "thread_id": tid,
                "subject": msgs[0]["subject"],
                "participants": list({m["sender"] for m in msgs if m["sender"]}),
                "message_count": len(msgs),
                "latest_date": msgs[0]["date"],
                "messages": msgs,
            })
        return result

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
        except Exception as e:
            logger.warning("[cache] fts_search failed: %s", e)
            return []

    def count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0]

    def count_by_sender(self, name: str) -> int:
        """Count emails whose sender field contains the given name (case-insensitive)."""
        pattern = f"%{name.lower()}%"
        with self._conn() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM emails WHERE LOWER(sender) LIKE ?", (pattern,)
            ).fetchone()[0]

    def get_cached_server_ids(self, account_id: int, folder: str, since_str: str) -> dict:
        """Return {server_id: cache_id} for emails in this account/folder since a date."""
        normalized = self._normalize_folder(folder)
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT id, server_id FROM emails
                   WHERE account_id = ? AND folder = ? AND date >= ?""",
                (account_id, normalized, since_str),
            ).fetchall()
        return {r["server_id"]: r["id"] for r in rows if r["server_id"]}

    def iter_all_emails(self, batch_size: int = 200):
        """Yield batches of all emails from SQLite for bulk reindexing."""
        offset = 0
        while True:
            with self._conn() as conn:
                rows = conn.execute(
                    "SELECT id, subject, sender, recipients, date, body, body_html,"
                    " thread_id, folder, is_read FROM emails ORDER BY rowid LIMIT ? OFFSET ?",
                    (batch_size, offset),
                ).fetchall()
            if not rows:
                break
            yield [self._to_message(dict(r)) for r in rows]
            offset += batch_size

    def clear_emails(self) -> int:
        """Delete all cached emails and related data. Returns number of emails deleted."""
        with self._conn() as conn:
            count = conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0]
            conn.execute("DELETE FROM action_items")
            conn.execute("DELETE FROM follow_ups")
            conn.execute("DELETE FROM email_categories")
            conn.execute("DELETE FROM email_snooze")
            conn.execute("DELETE FROM emails")
            conn.execute("INSERT INTO emails_fts(emails_fts) VALUES('rebuild')")
            conn.execute("UPDATE accounts SET last_ingested = NULL")
        # Reclaim disk space freed by the bulk delete
        with self._conn() as conn:
            conn.execute("VACUUM")
        return count

    def delete_email(self, email_id: str) -> bool:
        """Remove email and its FTS entry. Returns True if it existed."""
        with self._conn() as conn:
            deleted = conn.execute(
                "DELETE FROM emails WHERE id = ?", (email_id,)
            ).rowcount
            # FTS5 deletion is handled by the emails_ad trigger — no manual delete needed
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
            category=row.get("category") or None,
        )
