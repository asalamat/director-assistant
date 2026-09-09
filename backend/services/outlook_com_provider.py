"""
Outlook COM email provider — reads a live mailbox via a locally installed, signed-in
Outlook desktop app (Windows only). No Azure app registration or OAuth needed.
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from models import ConnectionConfig, EmailMessage

_SKIP_FOLDERS = {
    "junk email", "junk e-mail", "junk", "spam", "trash", "deleted items",
    "deleted messages", "drafts", "outbox", "rss feeds", "sync issues", "conversation history",
}

_OL_MAIL_ITEM = 43        # olMail
_OL_CONTACT_ITEM = 40     # olContact
_OL_APPOINTMENT_ITEM = 26 # olAppointment
_OL_FOLDER_INBOX = 6      # olFolderInbox
_OL_FOLDER_CONTACTS = 10  # olFolderContacts
_OL_FOLDER_CALENDAR = 9   # olFolderCalendar

_RESPONSE_MAP = {
    0: "", 1: "organizer", 2: "tentativelyAccepted", 3: "accepted",
    4: "declined", 5: "notResponded",
}


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


_PR_SENDER_SMTP_ADDRESS = "http://schemas.microsoft.com/mapi/proptag/0x5D01001F"
_PR_SMTP_ADDRESS = "http://schemas.microsoft.com/mapi/proptag/0x39FE001E"


def resolve_smtp_address(item) -> str:
    """Outlook COM returns an X.500 DN (/O=EXCHANGELABS/...) for the sender of
    internal Exchange mail instead of an SMTP address. PR_SENDER_SMTP_ADDRESS is
    the property Outlook itself resolves this to (works even offline/cached-mode,
    unlike GetExchangeUser which needs a live directory lookup) — try that first,
    then GetExchangeUser, then the AddressEntry's own PR_SMTP_ADDRESS, falling
    back to whatever Outlook originally gave us."""
    try:
        addr = item.SenderEmailAddress or ""
    except Exception:
        addr = ""
    if not addr.startswith("/O="):
        return addr or _sender_name(item)
    try:
        smtp = item.PropertyAccessor.GetProperty(_PR_SENDER_SMTP_ADDRESS)
        if smtp:
            return smtp
    except Exception:
        pass
    try:
        exch_user = item.Sender.GetExchangeUser()
        if exch_user and exch_user.PrimarySmtpAddress:
            return exch_user.PrimarySmtpAddress
    except Exception:
        pass
    try:
        smtp = item.Sender.PropertyAccessor.GetProperty(_PR_SMTP_ADDRESS)
        if smtp:
            return smtp
    except Exception:
        pass
    return addr or _sender_name(item)


def _sender_name(item) -> str:
    try:
        return item.SenderName or ""
    except Exception:
        return ""


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


def _root_folder(ns, username: str = ""):
    """Mailbox root — matches `username` against an Outlook account/store if given."""
    if username:
        for acc in ns.Accounts:
            try:
                if (getattr(acc, "SmtpAddress", "") or "").lower() == username.lower():
                    return acc.DeliveryStore.GetRootFolder()
            except Exception:
                continue
        for store in ns.Stores:
            try:
                if username.lower() in (store.DisplayName or "").lower():
                    return store.GetRootFolder()
            except Exception:
                continue
    return ns.GetDefaultFolder(_OL_FOLDER_INBOX).Parent


def _iter_folders(folder, prefix: str = ""):
    path = f"{prefix}/{folder.Name}" if prefix else folder.Name
    yield path, folder
    for sub in folder.Folders:
        yield from _iter_folders(sub, path)


def list_outlook_contacts(username: str = "") -> List[dict]:
    """Read the Contacts folder of a local Outlook profile (or a specific account's
    store when `username` is given). Returns [{"email", "name", "phones"}, ...]."""
    with _com_session() as (_, ns):
        contacts_folder = None
        if not username:
            try:
                contacts_folder = ns.GetDefaultFolder(_OL_FOLDER_CONTACTS)
            except Exception:
                contacts_folder = None
        if contacts_folder is None:
            root = _root_folder(ns, username)
            for _, f in _iter_folders(root):
                if f.Name.lower() == "contacts":
                    contacts_folder = f
                    break
        if contacts_folder is None:
            return []

        out: List[dict] = []
        items = contacts_folder.Items
        for i in range(1, items.Count + 1):
            try:
                item = items.Item(i)
                if getattr(item, "Class", None) != _OL_CONTACT_ITEM:
                    continue
                name = item.FullName or item.CompanyName or ""
                phones = [p for p in (
                    getattr(item, "BusinessTelephoneNumber", "") or "",
                    getattr(item, "MobileTelephoneNumber", "") or "",
                    getattr(item, "HomeTelephoneNumber", "") or "",
                ) if p]
                for attr in ("Email1Address", "Email2Address", "Email3Address"):
                    addr = (getattr(item, attr, "") or "").strip().lower()
                    if addr and "@" in addr:
                        out.append({"email": addr, "name": name, "phones": phones})
            except Exception:
                continue
        return out


def _parse_appointment(item) -> Optional[dict]:
    def _iso(dt) -> str:
        try:
            return datetime(dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second).isoformat()
        except Exception:
            return ""

    try:
        entry_id = item.EntryID
    except Exception:
        return None

    try:
        body = item.Body or ""
    except Exception:
        body = ""
    try:
        location = item.Location or ""
    except Exception:
        location = ""

    join_url = ""
    m = re.search(r"https://teams\.microsoft\.com/l/meetup-join/\S+", body)
    if m:
        join_url = m.group(0).rstrip(">.")
    is_online = bool(join_url) or "teams meeting" in location.lower() or "teams meeting" in body[:500].lower()

    try:
        required = item.RequiredAttendees or ""
    except Exception:
        required = ""
    try:
        optional = item.OptionalAttendees or ""
    except Exception:
        optional = ""
    attendee_count = len([a for a in re.split(r"[;,]", f"{required};{optional}") if a.strip()])

    try:
        response = _RESPONSE_MAP.get(item.ResponseStatus, "")
    except Exception:
        response = ""

    start_iso = _iso(getattr(item, "Start", None))
    return {
        "id": entry_id,
        "title": (getattr(item, "Subject", "") or "(No title)"),
        "start": start_iso,
        "end": _iso(getattr(item, "End", None)),
        "date": start_iso[:10],
        "location": location,
        "organizer": (getattr(item, "Organizer", "") or ""),
        "is_online": is_online,
        "join_url": join_url,
        "attendee_count": attendee_count,
        "response": response,
        "calendar_provider": "outlook_com",
    }


def list_outlook_calendar_events(username: str = "", days: int = 1) -> List[dict]:
    """Read the local Outlook Calendar folder (or a specific account's calendar
    when `username` is given) for events starting within the next `days` days."""
    with _com_session() as (_, ns):
        cal_folder = None
        if not username:
            try:
                cal_folder = ns.GetDefaultFolder(_OL_FOLDER_CALENDAR)
            except Exception:
                cal_folder = None
        if cal_folder is None:
            root = _root_folder(ns, username)
            for _, f in _iter_folders(root):
                if f.Name.lower() == "calendar":
                    cal_folder = f
                    break
        if cal_folder is None:
            return []

        start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=days)

        items = cal_folder.Items
        try:
            items.IncludeRecurrences = True
        except Exception:
            pass
        items.Sort("[Start]")
        try:
            dasl = (
                f"@SQL=\"urn:schemas:calendar:dtstart\" >= '{start.strftime('%Y-%m-%dT%H:%M:%SZ')}' "
                f"AND \"urn:schemas:calendar:dtstart\" <= '{end.strftime('%Y-%m-%dT%H:%M:%SZ')}'"
            )
            items = items.Restrict(dasl)
        except Exception as e:
            print(f"[outlook_com] calendar date restrict failed, scanning full folder: {e}")

        out: List[dict] = []
        for i in range(1, items.Count + 1):
            try:
                item = items.Item(i)
                if getattr(item, "Class", None) != _OL_APPOINTMENT_ITEM:
                    continue
                ev = _parse_appointment(item)
            except Exception:
                continue
            if ev:
                out.append(ev)
        return out


class OutlookComProvider:
    """Email provider backed by Outlook desktop COM automation."""

    def __init__(self, config: ConnectionConfig):
        self.username = config.username or ""

    def _find_folder(self, ns, name: str):
        target = name.lower()
        for path, f in _iter_folders(_root_folder(ns, self.username)):
            if path.lower() == target or f.Name.lower() == target:
                return f
        return None

    @staticmethod
    def _folder_items(folder, from_date=None):
        items = folder.Items
        items.Sort("[ReceivedTime]", True)
        if isinstance(from_date, datetime):
            try:
                # DASL/SQL syntax with an ISO date is locale-independent — the
                # plain "[ReceivedTime] >= 'MM/DD/YYYY...'" form Outlook also
                # accepts parses the literal using the OS's regional date format,
                # so on a non-US-locale Windows box it can silently fail to
                # restrict at all, forcing every poll to rescan the whole folder.
                dasl_date = from_date.strftime("%Y-%m-%dT%H:%M:%SZ")
                items = items.Restrict(
                    f"@SQL=\"urn:schemas:httpmail:datereceived\" >= '{dasl_date}'"
                )
            except Exception as e:
                print(f"[outlook_com] date restrict failed, scanning full folder: {e}")
        return items

    def _parse_item(self, item, folder_name: str) -> Optional[EmailMessage]:
        # One malformed/inaccessible item must never kill the whole folder generator
        # (a single unguarded property access here used to abort fetch_all mid-folder,
        # silently dropping every email after it — see resolve_smtp_address's history).
        try:
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

            try:
                subject = item.Subject or ""
            except Exception:
                subject = ""

            try:
                body = item.Body or ""
            except Exception:
                body = ""

            try:
                recipients = [r.strip() for r in re.split(r"[;,]", item.To or "") if r.strip()]
            except Exception:
                recipients = []

            return EmailMessage(
                id=entry_id,
                server_id=entry_id,
                subject=subject,
                sender=resolve_smtp_address(item),
                recipients=recipients,
                date=date,
                body=body,
                body_html=html_body,
                thread_id=getattr(item, "ConversationID", None),
                folder=folder_name,
                is_read=is_read,
            )
        except Exception as e:
            print(f"[outlook_com] skipping unparseable item in {folder_name}: {e}")
            return None

    # ── provider interface ────────────────────────────────────────────────────

    def test_connection(self) -> bool:
        with _com_session() as (_, ns):
            _root_folder(ns, self.username)  # raises if Outlook/profile isn't reachable
        return True

    def get_ingest_folders(self) -> List[str]:
        with _com_session() as (_, ns):
            kept = [f.Name for _, f in _iter_folders(_root_folder(ns, self.username))
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
                    em = self._parse_item(item, folder)
                except Exception as e:
                    print(f"[outlook_com] fetch_all: skipping item {i} in {folder}: {e}")
                    continue
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
