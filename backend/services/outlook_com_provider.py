"""
Outlook COM email provider — reads a live mailbox via a locally installed, signed-in
Outlook desktop app (Windows only). No Azure app registration or OAuth needed.
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import List, Optional

from models import ConnectionConfig, EmailMessage

_SKIP_FOLDERS = {
    "junk email", "junk e-mail", "junk", "spam", "trash", "deleted items",
    "deleted messages", "drafts", "outbox", "rss feeds", "sync issues", "conversation history",
}

_OL_MAIL_ITEM = 43       # olMail
_OL_FOLDER_INBOX = 6     # olFolderInbox


@contextmanager
def _com_session():
    """Yield (app, namespace) with the COM apartment initialized for this thread."""
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        app = win32com.client.Dispatch("Outlook.Application")
        yield app, app.GetNamespace("MAPI")
    finally:
        pythoncom.CoUninitialize()


def list_outlook_accounts() -> List[dict]:
    """Return [{"email": ..., "name": ...}] for every account configured in Outlook desktop.

    Lets the UI offer a picker instead of asking the user to type their exact
    Outlook profile address. Raises on non-Windows / Outlook not installed / not running.
    """
    with _com_session() as (_, ns):
        out = []
        for acc in ns.Accounts:
            try:
                email = getattr(acc, "SmtpAddress", "") or ""
                if email:
                    out.append({"email": email, "name": acc.DisplayName or email})
            except Exception:
                continue
        return out


class OutlookComProvider:
    """Email provider backed by Outlook desktop COM automation."""

    def __init__(self, config: ConnectionConfig):
        self.username = config.username or ""

    def _root_folder(self, ns):
        """Mailbox root — matches config.username against an Outlook account/store if given."""
        if self.username:
            for acc in ns.Accounts:
                try:
                    if (getattr(acc, "SmtpAddress", "") or "").lower() == self.username.lower():
                        return acc.DeliveryStore.GetRootFolder()
                except Exception:
                    continue
            for store in ns.Stores:
                try:
                    if self.username.lower() in (store.DisplayName or "").lower():
                        return store.GetRootFolder()
                except Exception:
                    continue
        return ns.GetDefaultFolder(_OL_FOLDER_INBOX).Parent

    def _iter_folders(self, folder, prefix: str = ""):
        path = f"{prefix}/{folder.Name}" if prefix else folder.Name
        yield path, folder
        for sub in folder.Folders:
            yield from self._iter_folders(sub, path)

    def _find_folder(self, ns, name: str):
        target = name.lower()
        for path, f in self._iter_folders(self._root_folder(ns)):
            if path.lower() == target or f.Name.lower() == target:
                return f
        return None

    @staticmethod
    def _folder_items(folder, from_date=None):
        items = folder.Items
        items.Sort("[ReceivedTime]", True)
        if isinstance(from_date, datetime):
            try:
                items = items.Restrict(from_date.strftime("[ReceivedTime] >= '%m/%d/%Y %I:%M %p'"))
            except Exception:
                pass
        return items

    def _parse_item(self, item, folder_name: str) -> Optional[EmailMessage]:
        if getattr(item, "Class", None) != _OL_MAIL_ITEM:
            return None
        try:
            entry_id = item.EntryID
        except Exception:
            return None

        date = None
        try:
            rt = item.ReceivedTime
            date = datetime(rt.year, rt.month, rt.day, rt.hour, rt.minute, rt.second, tzinfo=timezone.utc)
        except Exception:
            pass

        try:
            html_body = item.HTMLBody or None
        except Exception:
            html_body = None

        try:
            is_read = not item.UnRead
        except Exception:
            is_read = True

        return EmailMessage(
            id=entry_id,
            server_id=entry_id,
            subject=item.Subject or "",
            sender=item.SenderEmailAddress or item.SenderName or "",
            recipients=[r.strip() for r in re.split(r"[;,]", item.To or "") if r.strip()],
            date=date,
            body=item.Body or "",
            body_html=html_body,
            thread_id=getattr(item, "ConversationID", None),
            folder=folder_name,
            is_read=is_read,
        )

    # ── provider interface ────────────────────────────────────────────────────

    def test_connection(self) -> bool:
        with _com_session() as (_, ns):
            self._root_folder(ns)  # raises if Outlook/profile isn't reachable
        return True

    def get_ingest_folders(self) -> List[str]:
        with _com_session() as (_, ns):
            kept = [f.Name for _, f in self._iter_folders(self._root_folder(ns))
                    if f.Name.lower() not in _SKIP_FOLDERS]
            return kept or ["Inbox"]

    def get_poll_folders(self) -> List[str]:
        return ["Inbox", "Sent Items"]

    def fetch_all(self, folder: str = "Inbox", batch_size: int = 100, from_date=None):
        # ponytail: no pagination — Outlook COM Items is already local, batch_size unused.
        with _com_session() as (_, ns):
            f = self._find_folder(ns, folder)
            if f is None:
                return
            items = self._folder_items(f, from_date)
            total = items.Count
            for i in range(1, total + 1):
                try:
                    item = items.Item(i)
                except Exception:
                    continue
                em = self._parse_item(item, folder)
                if em:
                    yield em, total

    def get_uid_list(self, folder: str = "Inbox", from_date=None) -> set:
        with _com_session() as (_, ns):
            f = self._find_folder(ns, folder)
            if f is None:
                return set()
            ids: set = set()
            items = self._folder_items(f, from_date)
            for i in range(1, items.Count + 1):
                try:
                    item = items.Item(i)
                    if getattr(item, "Class", None) == _OL_MAIL_ITEM:
                        ids.add(item.EntryID)
                except Exception:
                    continue
            return ids

    def fetch_one(self, entry_id: str, folder: str = "Inbox") -> Optional[EmailMessage]:
        with _com_session() as (_, ns):
            try:
                item = ns.GetItemFromID(entry_id)
            except Exception:
                return None
            return self._parse_item(item, folder)

    def save_draft(self, to: str, subject: str, body: str) -> bool:
        with _com_session() as (app, _):
            try:
                mail = app.CreateItem(0)  # olMailItem
                mail.To = to
                mail.Subject = subject
                mail.Body = body
                mail.Save()
                return True
            except Exception as e:
                print(f"[outlook_com] save_draft failed: {e}")
                return False
