"""
SQLite-backed local email cache with FTS5 full-text search.
Eliminates repeated IMAP round-trips for list/fetch operations.
"""

import json
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import List, Optional

import json as _json
from models import EmailMessage, EmailSummary, ActionItem, FollowUp, Template, Account


class EmailCache:
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
            # Keep FTS index in sync automatically
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

            # One-time migration: normalize folder names stored before the
            # _normalize_folder fix (e.g. "inbox" → "INBOX", "sentitems" → "Sent")
            for old, new in [
                ("inbox", "INBOX"), ("Inbox", "INBOX"),
                ("sentitems", "Sent"), ("sent items", "Sent"), ("Sent Items", "Sent"),
                ("deleted items", "Trash"), ("deleteditems", "Trash"),
                ("junkemail", "Junk"), ("junk email", "Junk"),
            ]:
                conn.execute("UPDATE emails SET folder = ? WHERE folder = ?", (new, old))

            # ── Productivity tables ────────────────────────────────────────────
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

            # ── Multi-account support ──────────────────────────────────────────
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
            # Extend emails table for multi-account (safe: ignored if column exists)
            for col_def in [
                "account_id INTEGER DEFAULT 0",
                "server_id TEXT",
            ]:
                try:
                    conn.execute(f"ALTER TABLE emails ADD COLUMN {col_def}")
                except Exception:
                    pass

    # Canonical names for well-known folders so case-inconsistent providers
    # (Office365 returns "inbox"/"sentitems", IMAP returns "INBOX") all map
    # to the same value and appear correctly in the UI.
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
            getattr(email, "_server_id", email.id),
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
    ) -> tuple[list[EmailSummary], int]:
        col = self.SORT_COLS.get(sort_by, "date")
        direction = "ASC" if sort_order.lower() == "asc" else "DESC"

        # Normalize the requested folder and compare case-insensitively so that
        # emails stored before the folder-normalization fix still appear correctly.
        normalized = self._normalize_folder(folder)
        where = "UPPER(folder) = UPPER(?)"
        params: list = [normalized]

        if from_date:
            where += " AND date >= ?"
            params.append(from_date)

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
        summaries = [self._row_to_summary(dict(r)) for r in rows]
        return summaries, total

    def fts_search(self, query: str, limit: int = 30) -> list[EmailSummary]:
        """Full-text search using SQLite FTS5.
        FTS5 interprets ':', '-', '+', '*' etc. as operators, so we strip them
        and fall back to empty list on any parse error.
        """
        # Keep only alphanumerics and whitespace — avoids FTS5 operator collisions
        safe = re.sub(r'[^\w\s]', ' ', query)
        safe = ' '.join(safe.split()[:20])   # cap at 20 tokens
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

    def delete_email(self, email_id: str) -> bool:
        """Remove email and its FTS entry. Returns True if it existed."""
        with self._conn() as conn:
            deleted = conn.execute(
                "DELETE FROM emails WHERE id = ?", (email_id,)
            ).rowcount
            conn.execute("DELETE FROM emails_fts WHERE id = ?", (email_id,))
            conn.execute("DELETE FROM action_items WHERE email_id = ?", (email_id,))
        return deleted > 0

    # ── Action Items ──────────────────────────────────────────────────────────

    def add_action_items(self, email_id: str, email_subject: str, items: list[str]) -> int:
        rows = [(email_id, email_subject, t) for t in items if t.strip()]
        with self._conn() as conn:
            conn.execute("DELETE FROM action_items WHERE email_id = ?", (email_id,))
            conn.executemany(
                "INSERT INTO action_items (email_id, email_subject, text) VALUES (?,?,?)", rows
            )
        return len(rows)

    def list_action_items(self, done: bool | None = None) -> list[ActionItem]:
        where = "" if done is None else f"WHERE done = {1 if done else 0}"
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM action_items {where} ORDER BY created_at DESC"
            ).fetchall()
        return [ActionItem(**{**dict(r), "done": bool(r["done"])}) for r in rows]

    def set_action_done(self, item_id: int, done: bool) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE action_items SET done = ? WHERE id = ?", (1 if done else 0, item_id)
            )
        return cur.rowcount > 0

    # ── Follow-ups ────────────────────────────────────────────────────────────

    def add_follow_up(self, f: FollowUp) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO follow_ups (email_id, subject, sender, due_date, note)
                   VALUES (?,?,?,?,?)""",
                (f.email_id, f.subject, f.sender, f.due_date, f.note),
            )
            return cur.lastrowid

    def list_follow_ups(self, done: bool | None = None) -> list[FollowUp]:
        where = "" if done is None else f"WHERE done = {1 if done else 0}"
        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM follow_ups {where} ORDER BY due_date ASC"
            ).fetchall()
        return [FollowUp(**{**dict(r), "done": bool(r["done"])}) for r in rows]

    def set_follow_up_done(self, fid: int, done: bool) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE follow_ups SET done = ? WHERE id = ?", (1 if done else 0, fid)
            )
        return cur.rowcount > 0

    def delete_follow_up(self, fid: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM follow_ups WHERE id = ?", (fid,))
        return cur.rowcount > 0

    # ── Templates ─────────────────────────────────────────────────────────────

    def list_templates(self) -> list[Template]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM templates ORDER BY name").fetchall()
        return [Template(**dict(r)) for r in rows]

    def save_template(self, t: Template) -> int:
        with self._conn() as conn:
            if t.id:
                conn.execute(
                    "UPDATE templates SET name=?, body=?, updated_at=datetime('now') WHERE id=?",
                    (t.name, t.body, t.id),
                )
                return t.id
            cur = conn.execute(
                "INSERT INTO templates (name, body) VALUES (?,?)", (t.name, t.body)
            )
            return cur.lastrowid

    def delete_template(self, tid: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM templates WHERE id = ?", (tid,))
        return cur.rowcount > 0

    # ── Categories ────────────────────────────────────────────────────────────

    def set_category(self, email_id: str, category: str):
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO email_categories (email_id, category) VALUES (?,?)",
                (email_id, category),
            )

    def get_category(self, email_id: str) -> str | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT category FROM email_categories WHERE email_id = ?", (email_id,)
            ).fetchone()
        return row[0] if row else None

    # ── Analytics ─────────────────────────────────────────────────────────────

    def daily_volume(self, days: int = 30) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT substr(date, 1, 10) AS day, COUNT(*) AS cnt
                   FROM emails
                   WHERE date >= date('now', ? || ' days')
                   GROUP BY day ORDER BY day""",
                (f"-{days}",),
            ).fetchall()
        return [{"date": r["day"], "count": r["cnt"]} for r in rows]

    def top_senders(self, limit: int = 10) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT sender, COUNT(*) AS cnt FROM emails
                   GROUP BY sender ORDER BY cnt DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        return [{"sender": r["sender"], "count": r["cnt"]} for r in rows]

    def folder_breakdown(self) -> dict[str, int]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT folder, COUNT(*) AS cnt FROM emails GROUP BY folder"
            ).fetchall()
        return {r["folder"]: r["cnt"] for r in rows}

    def sender_stats(self, sender: str) -> dict:
        with self._conn() as conn:
            row = conn.execute(
                """SELECT COUNT(*) AS cnt,
                          MIN(date) AS first_contact,
                          MAX(date) AS last_contact
                   FROM emails WHERE sender = ?""",
                (sender,),
            ).fetchone()
            subjects = conn.execute(
                """SELECT subject FROM emails WHERE sender = ?
                   ORDER BY date DESC LIMIT 5""",
                (sender,),
            ).fetchall()
        return {
            "total_emails": row["cnt"],
            "first_contact": row["first_contact"],
            "last_contact": row["last_contact"],
            "recent_subjects": [r["subject"] for r in subjects],
        }

    # ── Accounts ──────────────────────────────────────────────────────────────

    def _row_to_account(self, row: dict) -> Account:
        cfg = _json.loads(row.get("config_json") or "{}")
        return Account(
            id=row["id"],
            name=row.get("name") or "",
            provider=row["provider"],
            username=row["username"],
            active=bool(row.get("active", 1)),
            last_ingested=row.get("last_ingested"),
            created_at=row.get("created_at"),
            password=cfg.get("password"),
            imap_host=cfg.get("imap_host"),
            imap_port=cfg.get("imap_port", 993),
            tenant_id=cfg.get("tenant_id"),
            client_id=cfg.get("client_id"),
            client_secret=cfg.get("client_secret"),
        )

    def list_accounts(self) -> list[Account]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM accounts ORDER BY id").fetchall()
        return [self._row_to_account(dict(r)) for r in rows]

    def get_account(self, account_id: int) -> Account | None:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        return self._row_to_account(dict(row)) if row else None

    def add_account(self, account: Account) -> int:
        cfg = _json.dumps({
            "password": account.password,
            "imap_host": account.imap_host,
            "imap_port": account.imap_port,
            "tenant_id": account.tenant_id,
            "client_id": account.client_id,
            "client_secret": account.client_secret,
        })
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO accounts (name, provider, username, config_json) VALUES (?,?,?,?)",
                (account.name or account.username, account.provider, account.username, cfg),
            )
            return cur.lastrowid

    def remove_account(self, account_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        return cur.rowcount > 0

    def mark_ingested(self, account_id: int):
        with self._conn() as conn:
            conn.execute(
                "UPDATE accounts SET last_ingested = datetime('now') WHERE id = ?",
                (account_id,),
            )

    def import_legacy_config(self, config_json: str) -> int | None:
        """Import single-account config.json as account 1 (idempotent)."""
        try:
            data = _json.loads(config_json)
        except Exception:
            return None
        with self._conn() as conn:
            count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
            if count > 0:
                return None      # accounts already set up
        from models import Account, EmailProviderType
        cfg = Account(
            provider=data.get("provider", "generic_imap"),
            username=data.get("username", ""),
            name=data.get("username", ""),
            password=data.get("password"),
            imap_host=data.get("imap_host"),
            imap_port=data.get("imap_port", 993),
            tenant_id=data.get("tenant_id"),
            client_id=data.get("client_id"),
            client_secret=data.get("client_secret"),
        )
        return self.add_account(cfg)

    def get_email_account(self, email_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT account_id, server_id FROM emails WHERE id = ?", (email_id,)
            ).fetchone()
        return dict(row) if row else None

    def recent_emails_for_digest(self, hours: int = 24) -> list[EmailSummary]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT id, subject, sender, date, body, is_read FROM emails
                   WHERE date >= datetime('now', ? || ' hours')
                   ORDER BY date DESC""",
                (f"-{hours}",),
            ).fetchall()
        return [self._row_to_summary(dict(r)) for r in rows]

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
