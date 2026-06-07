"""
EmailRepository — thin focused interface over EmailCache email CRUD.

Routers should import from here instead of accessing cache.* directly.
The cache object is still the source of truth; this class delegates to it.
"""
from __future__ import annotations
from typing import Optional, List
from models import EmailMessage, EmailSummary


class EmailRepository:
    """Read/write access to emails. Delegates to EmailCache."""

    def __init__(self, cache):
        self._cache = cache

    # ── Write ─────────────────────────────────────────────────────────────────

    def save(self, email: EmailMessage, account_id: int = 0) -> bool:
        return self._cache.save(email, account_id)

    def save_batch(self, emails: List[EmailMessage], account_id: int = 0) -> int:
        return self._cache.save_batch(emails, account_id)

    def delete(self, email_id: str) -> bool:
        return self._cache.delete_email(email_id)

    def clear_all(self) -> int:
        return self._cache.clear_emails()

    # ── Read ──────────────────────────────────────────────────────────────────

    def get(self, email_id: str) -> Optional[EmailMessage]:
        return self._cache.get(email_id)

    def list(self, folder: str = "INBOX", skip: int = 0, limit: int = 50,
             sort_by: str = "date", sort_order: str = "desc",
             from_date: Optional[str] = None, account_id: Optional[int] = None,
             only_unread: bool = False):
        return self._cache.list_emails(
            folder=folder, skip=skip, limit=limit,
            sort_by=sort_by, sort_order=sort_order,
            from_date=from_date, account_id=account_id,
            only_unread=only_unread,
        )

    def search(self, query: str, limit: int = 30) -> List[EmailSummary]:
        return self._cache.fts_search(query, limit)

    def list_threads(self, folder: str = "INBOX", skip: int = 0,
                     limit: int = 50, account_id: Optional[int] = None):
        return self._cache.list_threads(folder=folder, skip=skip,
                                        limit=limit, account_id=account_id)

    def count(self) -> int:
        return self._cache.count()

    def count_unread(self) -> int:
        return self._cache.count_unread()

    def folder_breakdown(self) -> dict:
        return self._cache.folder_breakdown()

    def get_server_ids(self, account_id: int, folder: str, since_str: str) -> dict:
        return self._cache.get_cached_server_ids(account_id, folder, since_str)

    def iter_all(self, batch_size: int = 200):
        return self._cache.iter_all_emails(batch_size)

    # ── Snooze ────────────────────────────────────────────────────────────────

    def snooze(self, email_id: str, wake_date: str) -> None:
        self._cache.snooze_email(email_id, wake_date)

    def unsnooze(self, email_id: str) -> None:
        self._cache.unsnooze_email(email_id)

    # ── Misc ──────────────────────────────────────────────────────────────────

    def set_category(self, email_id: str, category: str) -> None:
        self._cache.set_category(email_id, category)

    def get_category(self, email_id: str) -> Optional[str]:
        return self._cache.get_category(email_id)

    def set_followup_remind(self, email_id: str, remind_at: str) -> bool:
        return self._cache.set_followup_remind_at(email_id, remind_at)

    def list_followup_due(self, as_of: Optional[str] = None) -> list:
        return self._cache.list_followup_due(as_of=as_of)
