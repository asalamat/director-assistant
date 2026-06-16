"""
Mixin for EmailCache: productivity tables (action items, follow-ups,
templates, categories), analytics queries, and account management.
Depends on self._conn() and self._row_to_summary() from EmailCache core.
"""

import json as _json
from typing import Optional
from models import ActionItem, FollowUp, Template, Account

_KR_SERVICE = "director-assistant"

# In-memory cache so keychain is only accessed once per account per session.
_kr_cache: dict[int, str | None] = {}
# Accounts where keychain write has already failed this session — skip retries.
_kr_set_failed: set[int] = set()


def _is_permanent_kr_error(exc: Exception) -> bool:
    """True only for errors indicating keychain is structurally absent, not transiently locked."""
    try:
        from keyring.errors import NoKeyringError
        return isinstance(exc, NoKeyringError)
    except ImportError:
        return True  # keyring.errors not importable → no usable keyring


def _kr_get(account_id: int) -> str | None:
    """Retrieve password from OS keychain. Returns None if unavailable."""
    if account_id in _kr_cache:
        return _kr_cache[account_id]
    try:
        import keyring
        val = keyring.get_password(_KR_SERVICE, str(account_id))
        _kr_cache[account_id] = val
        return val
    except Exception as e:
        if _is_permanent_kr_error(e):
            _kr_cache[account_id] = None
            _kr_set_failed.add(account_id)
        # transient error: don't cache so the next call retries
        return None


def _kr_set(account_id: int, password: str) -> bool:
    """Store password in OS keychain. Returns True on success."""
    if account_id in _kr_set_failed:
        return False
    try:
        import keyring
        keyring.set_password(_KR_SERVICE, str(account_id), password)
        _kr_cache[account_id] = password
        return True
    except Exception as e:
        if _is_permanent_kr_error(e):
            _kr_set_failed.add(account_id)
        return False


def _kr_delete(account_id: int):
    """Remove password from OS keychain (best-effort)."""
    _kr_cache.pop(account_id, None)
    _kr_set_failed.discard(account_id)
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
        sql = "SELECT * FROM action_items"
        params: tuple = ()
        if done is not None:
            sql += " WHERE done = ?"
            params = (1 if done else 0,)
        sql += " ORDER BY created_at DESC"
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
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
        sql = "SELECT * FROM follow_ups"
        params: tuple = ()
        if done is not None:
            sql += " WHERE done = ?"
            params = (1 if done else 0,)
        sql += " ORDER BY due_date ASC"
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [FollowUp(**{**dict(r), "done": bool(r["done"])}) for r in rows]

    def set_follow_up_done(self, fid: int, done: bool) -> bool:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE follow_ups SET done = ? WHERE id = ?", (1 if done else 0, fid)
            )
        return cur.rowcount > 0

    def update_follow_up_due_date(self, fid: int, due_date: str) -> bool:
        with self._conn() as conn:
            cur = conn.execute("UPDATE follow_ups SET due_date = ? WHERE id = ?", (due_date, fid))
        return cur.rowcount > 0

    def delete_follow_up(self, fid: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM follow_ups WHERE id = ?", (fid,))
        return cur.rowcount > 0

    # ── Triage Rules ──────────────────────────────────────────────────────────

    def list_triage_rules(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, rule, created_at FROM triage_rules ORDER BY id"
            ).fetchall()
        return [dict(r) for r in rows]

    def add_triage_rule(self, rule: str) -> int:
        with self._conn() as conn:
            cur = conn.execute("INSERT INTO triage_rules (rule) VALUES (?)", (rule.strip(),))
        return cur.lastrowid

    def delete_triage_rule(self, rule_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM triage_rules WHERE id = ?", (rule_id,))
        return cur.rowcount > 0

    # ── Snooze ────────────────────────────────────────────────────────────────

    def snooze_email(self, email_id: str, wake_date: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO email_snooze (email_id, wake_date) VALUES (?,?)",
                (email_id, wake_date),
            )

    def unsnooze_email(self, email_id: str) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM email_snooze WHERE email_id = ?", (email_id,))

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

    def count_unread(self) -> int:
        with self._conn() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM emails WHERE is_read = 0"
            ).fetchone()[0]

    def sender_monthly_volume(self, sender_email: str, months: int = 12) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT strftime('%Y-%m', date) AS month, COUNT(*) AS cnt
                   FROM emails WHERE LOWER(sender) = LOWER(?)
                   AND date >= datetime('now', '-' || ? || ' months')
                   GROUP BY month ORDER BY month""",
                (sender_email, str(months)),
            ).fetchall()
        return [{"month": r["month"], "count": r["cnt"]} for r in rows]

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

    def contact_relationship(self, sender: str) -> dict:
        """Rich relationship stats: reply rate, avg response time, unreplied count."""
        sender_lower = sender.lower()
        with self._conn() as conn:
            # Emails received from this sender
            received = conn.execute(
                """SELECT id, subject, sender, date, thread_id
                   FROM emails WHERE LOWER(sender) = ?
                   ORDER BY date DESC LIMIT 100""",
                (sender_lower,),
            ).fetchall()

            # Emails you sent to this sender (their address in recipients)
            sent_to = conn.execute(
                """SELECT id, subject, date, recipients, thread_id
                   FROM emails WHERE LOWER(folder) LIKE '%sent%'
                   AND LOWER(recipients) LIKE ?
                   ORDER BY date DESC LIMIT 100""",
                (f"%{sender_lower}%",),
            ).fetchall()

            # Last email you sent them
            last_sent_row = sent_to[0] if sent_to else None

            # Unreplied: received emails whose thread has no outbound reply
            sent_thread_ids = {r["thread_id"] for r in sent_to if r["thread_id"]}
            unreplied = [
                r for r in received
                if r["thread_id"] and r["thread_id"] not in sent_thread_ids
                or not r["thread_id"]
            ]

            # Average response time: for threads where you replied, measure gap
            response_times = []
            for recv in received[:30]:
                if not recv["thread_id"]:
                    continue
                reply = conn.execute(
                    """SELECT date FROM emails
                       WHERE thread_id = ? AND LOWER(folder) LIKE '%sent%'
                       AND date > ? LIMIT 1""",
                    (recv["thread_id"], recv["date"]),
                ).fetchone()
                if reply and recv["date"] and reply["date"]:
                    try:
                        from datetime import datetime, timezone
                        t1 = datetime.fromisoformat(recv["date"].replace("Z", "+00:00"))
                        t2 = datetime.fromisoformat(reply["date"].replace("Z", "+00:00"))
                        delta = (t2 - t1).total_seconds() / 3600  # hours
                        if 0 < delta < 720:  # ignore > 30 days
                            response_times.append(delta)
                    except Exception:
                        pass

        avg_response_h = round(sum(response_times) / len(response_times), 1) if response_times else None
        return {
            "total_received": len(received),
            "total_sent_to": len(sent_to),
            "last_received": received[0]["date"][:10] if received else None,
            "last_sent_to": last_sent_row["date"][:10] if last_sent_row else None,
            "unreplied_count": len(unreplied),
            "avg_response_hours": avg_response_h,
            "recent_subjects": [r["subject"] for r in received[:5]],
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

        # Branch on token provider
        if cfg.get("token_provider") == "google":
            return self._refresh_google_token(account_id, cfg)

        try:
            import httpx
            r = httpx.post(
                "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": client_id,
                    "refresh_token": refresh_token,
                    "scope": (
                        "offline_access "
                        "https://graph.microsoft.com/User.Read "
                        "https://graph.microsoft.com/Mail.Read "
                        "https://graph.microsoft.com/Mail.ReadWrite "
                        "https://graph.microsoft.com/Files.Read "
                        "https://graph.microsoft.com/Calendars.Read "
                        "https://graph.microsoft.com/Contacts.Read"
                    ),
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

    def _refresh_google_token(self, account_id: int, cfg: dict) -> str | None:
        """Refresh a Google OAuth2 access token using the stored refresh token."""
        refresh_token = cfg.get("refresh_token", "")
        client_id = cfg.get("client_id", "")
        client_secret = cfg.get("client_secret", "")
        if not refresh_token or not client_id:
            return None
        try:
            import httpx
            r = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                },
                timeout=15,
            )
            data = r.json()
            new_token = data.get("access_token")
            new_refresh = data.get("refresh_token", refresh_token)
            if new_token:
                self.store_account_token(account_id, new_token, refresh_token=new_refresh)
                print(f"[oauth] refreshed Google token for account {account_id}", flush=True)
                return new_token
        except Exception as e:
            print(f"[oauth] Google token refresh failed for account {account_id}: {e}", flush=True)
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

    # ── Saved Searches ────────────────────────────────────────────────────────

    def list_saved_searches(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM saved_searches ORDER BY created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def add_saved_search(self, name: str, query: str, folder: str = "INBOX") -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO saved_searches (name, query, folder) VALUES (?,?,?)",
                (name, query, folder),
            )
            return cur.lastrowid

    def delete_saved_search(self, sid: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM saved_searches WHERE id = ?", (sid,))
        return cur.rowcount > 0

    # ── Follow-up Reminders ───────────────────────────────────────────────────

    def set_followup_remind_at(self, email_id: str, remind_at: str) -> bool:
        """Set or clear the followup_remind_at timestamp for an email.
        Pass remind_at='' to clear the reminder."""
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE emails SET followup_remind_at = ? WHERE id = ?",
                (remind_at or None, email_id),
            )
        return cur.rowcount > 0

    def list_followup_due(self, as_of: Optional[str] = None) -> list[dict]:
        """Return emails whose followup_remind_at is <= as_of (defaults to now)."""
        cutoff = as_of or "datetime('now')"
        with self._conn() as conn:
            if as_of:
                rows = conn.execute(
                    """SELECT id, subject, sender, date, body, is_read, followup_remind_at
                       FROM emails
                       WHERE followup_remind_at IS NOT NULL
                         AND followup_remind_at <= ?
                       ORDER BY followup_remind_at ASC""",
                    (as_of,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """SELECT id, subject, sender, date, body, is_read, followup_remind_at
                       FROM emails
                       WHERE followup_remind_at IS NOT NULL
                         AND followup_remind_at <= datetime('now')
                       ORDER BY followup_remind_at ASC"""
                ).fetchall()
        return [
            {
                "id": r["id"],
                "subject": r["subject"] or "(no subject)",
                "sender": r["sender"] or "",
                "date": r["date"],
                "preview": ((r["body"] or "")[:160]).replace("\n", " "),
                "is_read": bool(r["is_read"]),
                "followup_remind_at": r["followup_remind_at"],
            }
            for r in rows
        ]

    # ── Ask History ──────────────────────────────────────────────────────────

    def save_ask_history(self, question: str, answer: str, results_json: str = "[]") -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO ask_history (question, answer, results_json) VALUES (?,?,?)",
                (question, answer, results_json),
            )
            return cur.lastrowid

    def list_ask_history(self, limit: int = 50, skip: int = 0) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, timestamp, question, answer, results_json FROM ask_history "
                "ORDER BY id DESC LIMIT ? OFFSET ?",
                (limit, skip),
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_ask_history(self, entry_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM ask_history WHERE id = ?", (entry_id,))
        return cur.rowcount > 0

    # ── Scheduled Sends ──────────────────────────────────────────────────────

    def schedule_send(self, account_id: int, to_addr: str, subject: str, body: str, send_at: str) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO scheduled_sends (account_id, to_addr, subject, body, send_at) VALUES (?,?,?,?,?)",
                (account_id, to_addr, subject, body, send_at),
            )
        return cur.lastrowid

    def list_scheduled_sends(self, sent: bool = False) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, account_id, to_addr, subject, body, send_at, sent, created_at "
                "FROM scheduled_sends WHERE sent = ? ORDER BY send_at", (1 if sent else 0,)
            ).fetchall()
        return [dict(r) for r in rows]

    def cancel_scheduled_send(self, send_id: int) -> bool:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM scheduled_sends WHERE id = ? AND sent = 0", (send_id,))
        return cur.rowcount > 0

    def mark_sent(self, send_id: int) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE scheduled_sends SET sent = 1 WHERE id = ?", (send_id,))

    # ── Email account lookup ──────────────────────────────────────────────────

    def get_email_account(self, email_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT account_id, server_id FROM emails WHERE id = ?", (email_id,)
            ).fetchone()
        return dict(row) if row else None
