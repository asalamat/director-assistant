"""
Mixin for EmailCache: productivity tables (action items, follow-ups,
templates, categories), analytics queries, and account management.
Depends on self._conn() and self._row_to_summary() from EmailCache core.
"""

import json as _json
from models import ActionItem, FollowUp, Template, Account

_KR_SERVICE = "director-assistant"


def _kr_get(account_id: int) -> str | None:
    """Retrieve password from OS keychain. Returns None if unavailable."""
    try:
        import keyring
        return keyring.get_password(_KR_SERVICE, str(account_id))
    except Exception:
        return None


def _kr_set(account_id: int, password: str) -> bool:
    """Store password in OS keychain. Returns True on success."""
    try:
        import keyring
        keyring.set_password(_KR_SERVICE, str(account_id), password)
        return True
    except Exception:
        return False


def _kr_delete(account_id: int):
    """Remove password from OS keychain (best-effort)."""
    try:
        import keyring
        keyring.delete_password(_KR_SERVICE, str(account_id))
    except Exception:
        pass


class EmailExtrasMixin:

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

    def recent_emails_for_digest(self, hours: int = 24) -> list:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT id, subject, sender, date, body, is_read FROM emails
                   WHERE date >= datetime('now', ? || ' hours')
                   ORDER BY date DESC""",
                (f"-{hours}",),
            ).fetchall()
        return [self._row_to_summary(dict(r)) for r in rows]

    # ── Accounts ──────────────────────────────────────────────────────────────

    def _row_to_account(self, row: dict) -> Account:
        cfg = _json.loads(row.get("config_json") or "{}")
        account_id = row["id"]

        # Try OS keychain first; fall back to DB plaintext (legacy or keychain unavailable).
        # Migrate on-the-fly: if plaintext is found in DB and keychain write succeeds, clear it.
        password = _kr_get(account_id)
        if not password:
            password = cfg.get("password")
            if password and account_id and _kr_set(account_id, password):
                self._clear_db_password(account_id)

        return Account(
            id=account_id,
            name=row.get("name") or "",
            provider=row["provider"],
            username=row["username"],
            active=bool(row.get("active", 1)),
            last_ingested=row.get("last_ingested"),
            created_at=row.get("created_at"),
            password=password,
            imap_host=cfg.get("imap_host"),
            imap_port=cfg.get("imap_port", 993),
            tenant_id=cfg.get("tenant_id"),
            client_id=cfg.get("client_id"),
            client_secret=cfg.get("client_secret"),
            access_token=cfg.get("access_token"),
        )

    def _clear_db_password(self, account_id: int):
        """Null out the password field in config_json after migrating to keychain."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT config_json FROM accounts WHERE id = ?", (account_id,)
            ).fetchone()
            if row:
                cfg = _json.loads(row[0] or "{}")
                cfg["password"] = None
                conn.execute(
                    "UPDATE accounts SET config_json = ? WHERE id = ?",
                    (_json.dumps(cfg), account_id),
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
        # Store password in DB initially so the row is self-contained on insert.
        # Immediately after, try to move it to the OS keychain and clear from DB.
        cfg = _json.dumps({
            "password": account.password,
            "imap_host": account.imap_host,
            "imap_port": account.imap_port,
            "tenant_id": account.tenant_id,
            "client_id": account.client_id,
            "client_secret": account.client_secret,
            "access_token": account.access_token,
        })
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO accounts (name, provider, username, config_json) VALUES (?,?,?,?)",
                (account.name or account.username, account.provider, account.username, cfg),
            )
            account_id = cur.lastrowid

        if account.password and _kr_set(account_id, account.password):
            self._clear_db_password(account_id)

        return account_id

    def remove_account(self, account_id: int) -> bool:
        _kr_delete(account_id)
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        return cur.rowcount > 0

    def store_account_token(self, account_id: int, access_token: str, refresh_token: str = ""):
        """Persist an OAuth access token (and optional refresh token) for an existing account."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT config_json FROM accounts WHERE id = ?", (account_id,)
            ).fetchone()
            if not row:
                return
            cfg = _json.loads(row[0] or "{}")
            cfg["access_token"] = access_token
            if refresh_token:
                cfg["refresh_token"] = refresh_token
            conn.execute(
                "UPDATE accounts SET config_json = ? WHERE id = ?",
                (_json.dumps(cfg), account_id),
            )

    def refresh_oauth_token(self, account_id: int) -> str | None:
        """Use the stored refresh_token to get a new access_token. Returns new token or None."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT config_json FROM accounts WHERE id = ?", (account_id,)
            ).fetchone()
        if not row:
            return None
        cfg = _json.loads(row[0] or "{}")
        refresh_token = cfg.get("refresh_token", "")
        client_id = cfg.get("client_id", "")
        if not refresh_token or not client_id:
            return None
        try:
            import httpx
            r = httpx.post(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": client_id,
                    "refresh_token": refresh_token,
                    "scope": "https://outlook.office.com/IMAP.AccessAsUser.All offline_access",
                },
                timeout=15,
            )
            data = r.json()
            new_token = data.get("access_token")
            new_refresh = data.get("refresh_token", refresh_token)
            if new_token:
                self.store_account_token(account_id, new_token, refresh_token=new_refresh)
                print(f"[oauth] refreshed access token for account {account_id}", flush=True)
                return new_token
        except Exception as e:
            print(f"[oauth] token refresh failed for account {account_id}: {e}", flush=True)
        return None

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
                return None
        from models import Account
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
