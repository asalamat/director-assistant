"""
IMAP email provider — Yahoo, Gmail, Hotmail, and generic IMAP servers.
"""

import imaplib
import email as email_lib
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
import re
import html
from typing import Optional, List
from datetime import datetime

from models import EmailMessage, EmailProviderType, ConnectionConfig


def _decode_mime_header(value: str) -> str:
    if not value:
        return ""
    parts = decode_header(value)
    result = []
    for text, charset in parts:
        if isinstance(text, bytes):
            result.append(text.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(text)
    return "".join(result)


def _html_to_text(html_body: str) -> str:
    text = re.sub(r'<br\s*/?>', '\n', html_body, flags=re.IGNORECASE)
    text = re.sub(r'<p[^>]*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def _extract_body(msg) -> tuple[Optional[str], Optional[str]]:
    plain = None
    html_body = None
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if "attachment" in cd:
                continue
            if ct == "text/plain" and plain is None:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    plain = payload.decode(charset, errors="replace")
            elif ct == "text/html" and html_body is None:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    html_body = payload.decode(charset, errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            ct = msg.get_content_type()
            if ct == "text/html":
                html_body = payload.decode(charset, errors="replace")
            else:
                plain = payload.decode(charset, errors="replace")
    return plain, html_body


IMAP_HOSTS: dict[str, tuple[str, int]] = {
    EmailProviderType.YAHOO_IMAP: ("imap.mail.yahoo.com", 993),
    EmailProviderType.GMAIL:      ("imap.gmail.com", 993),
    EmailProviderType.HOTMAIL:    ("outlook.office365.com", 993),
}

IMAP_CONNECT_TIMEOUT = 10  # seconds — bounds TCP connect + SSL handshake


class IMAPProvider:
    """Works with Yahoo, Gmail, Hotmail, and generic IMAP servers."""

    def __init__(self, config: ConnectionConfig):
        default_host, default_port = IMAP_HOSTS.get(config.provider, ("", 993))
        self.host = config.imap_host or default_host or "imap.mail.yahoo.com"
        self.port = config.imap_port or default_port
        self.username = config.username
        self.password = config.password or ""
        self.access_token = config.access_token or ""
        self._mail: Optional[imaplib.IMAP4_SSL] = None

    def connect(self):
        import base64
        import socket as _socket
        old = _socket.getdefaulttimeout()
        _socket.setdefaulttimeout(IMAP_CONNECT_TIMEOUT)
        password = self.password.replace(" ", "")  # strip display spaces from app passwords
        try:
            self._mail = imaplib.IMAP4_SSL(self.host, self.port, timeout=IMAP_CONNECT_TIMEOUT)
            if self.access_token:
                # OAuth2 / Modern Auth — works with Microsoft accounts that have disabled basic auth
                xoauth2 = base64.b64encode(
                    f"user={self.username}\x01auth=Bearer {self.access_token}\x01\x01".encode()
                ).decode()
                calls = []
                def _xoauth2_cb(challenge):
                    if not calls:          # first call — send credentials
                        calls.append(1)
                        return xoauth2
                    # Second call = server returned a base64-encoded JSON error
                    if challenge:
                        try:
                            import json
                            err = json.loads(base64.b64decode(challenge))
                            scope = err.get("scope", "")
                            raise imaplib.IMAP4.error(
                                f"XOAUTH2 rejected — token missing scope. "
                                f"Add IMAP.AccessAsUser.All to your Azure app. "
                                f"Server requires: {scope}"
                            )
                        except imaplib.IMAP4.error:
                            raise
                        except Exception:
                            pass
                    return ""              # must send empty to complete SASL exchange
                self._mail.authenticate("XOAUTH2", _xoauth2_cb)
            else:
                try:
                    self._mail.login(self.username, password)
                except imaplib.IMAP4.error:
                    # Fallback: some servers reject LOGIN but accept AUTHENTICATE PLAIN
                    creds = f"\x00{self.username}\x00{password}".encode()
                    self._mail.authenticate(
                        "PLAIN", lambda _: base64.b64encode(creds).decode()
                    )
        finally:
            _socket.setdefaulttimeout(old)

    def disconnect(self):
        if self._mail:
            try:
                self._mail.logout()
            except Exception:
                pass
            self._mail = None

    def test_connection(self) -> bool:
        self.connect()
        self.disconnect()
        return True

    def _imap_op(self, fn):
        """Run fn() with one automatic reconnect if the server dropped the connection."""
        if self._mail is None:
            self.connect()
        try:
            return fn()
        except imaplib.IMAP4.abort:
            self._mail = None
            self.connect()
            return fn()

    def _parse_message(self, raw: bytes, uid: str, folder: str) -> EmailMessage:
        msg = email_lib.message_from_bytes(raw)
        subject = _decode_mime_header(msg.get("Subject", ""))
        from_raw = msg.get("From", "")
        _, sender_addr = parseaddr(from_raw)
        sender = sender_addr or _decode_mime_header(from_raw)

        to_raw = msg.get("To", "")
        recipients = [addr for _, addr in
                      [parseaddr(r.strip()) for r in to_raw.split(",") if r.strip()]]

        date = None
        date_str = msg.get("Date", "")
        if date_str:
            try:
                date = parsedate_to_datetime(date_str)
            except Exception:
                pass

        thread_id = msg.get("Message-ID", uid)
        plain, html_body = _extract_body(msg)
        if not plain and html_body:
            plain = _html_to_text(html_body)

        return EmailMessage(
            id=uid,
            subject=subject,
            sender=sender,
            recipients=recipients,
            date=date,
            body=plain,
            body_html=html_body,
            thread_id=thread_id,
            folder=folder,
            is_read=True,
        )

    def list_folders(self) -> List[str]:
        def _op():
            _, folders = self._mail.list()
            result = []
            for f in folders:
                parts = f.decode().split('"/"')
                if parts:
                    result.append(parts[-1].strip().strip('"'))
            return result
        return self._imap_op(_op)

    def find_sent_folder(self) -> str:
        try:
            folders = self.list_folders()
            candidates = ["Sent", "Sent Items", "Sent Mail", "SENT", "&Sent Items&-"]
            for c in candidates:
                if c in folders:
                    return c
            for f in folders:
                if "sent" in f.lower():
                    return f
        except Exception:
            pass
        return "Sent"

    def _find_folder(self, candidates: List[str]) -> Optional[str]:
        try:
            folders = self.list_folders()
            folders_lower = {f.lower(): f for f in folders}
            for c in candidates:
                match = folders_lower.get(c.lower())
                if match:
                    return match
        except Exception:
            pass
        return None

    def get_ingest_folders(self) -> List[str]:
        """INBOX + Sent + Bulk/Spam so marketing and notification emails are caught."""
        folders = ["INBOX", self.find_sent_folder()]
        bulk = self._find_folder([
            "Bulk Mail", "Bulk", "Spam", "Junk", "Junk Mail",
            "Junk E-mail", "JUNK", "SPAM",
        ])
        if bulk:
            folders.append(bulk)
        return folders

    def search_by_subject(self, subject: str, folder: str = "INBOX", limit: int = 10):
        """Search IMAP folder for emails matching subject. Yields (EmailMessage, total)."""
        safe = subject.replace('"', '')

        def _setup():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.search(None, f'SUBJECT "{safe}"')
            uids = data[0].split()
            recent = uids[-limit:] if len(uids) > limit else uids
            return uids, recent

        uids, recent = self._imap_op(_setup)
        total = len(uids)
        if not recent:
            return
        uid_str = ",".join(u.decode() for u in recent)
        _, fetch_data = self._mail.fetch(uid_str, "(RFC822)")
        for item in fetch_data:
            if isinstance(item, tuple):
                uid = item[0].decode().split()[0]
                try:
                    yield self._parse_message(item[1], uid, folder), total
                except Exception as e:
                    print(f"[provider] parse error uid={uid}: {e}")

    def get_uid_list(self, folder: str = "INBOX", from_date=None) -> set:
        """Return server UIDs for the folder (no body download). Used for deletion detection."""
        criteria = f'SINCE "{self._imap_date(from_date)}"' if from_date else "ALL"

        def _op():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.search(None, criteria)
            return {u.decode() for u in data[0].split() if u}

        return self._imap_op(_op)

    @staticmethod
    def _imap_date(dt) -> str:
        months = ["Jan","Feb","Mar","Apr","May","Jun",
                  "Jul","Aug","Sep","Oct","Nov","Dec"]
        return f"{dt.day:02d}-{months[dt.month-1]}-{dt.year}"

    def fetch_all(self, folder: str = "INBOX", batch_size: int = 100, from_date=None):
        """Yield (EmailMessage, total) for every email in folder."""
        criteria = f'SINCE "{self._imap_date(from_date)}"' if from_date else "ALL"

        def _setup():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.search(None, criteria)
            return data[0].split()

        uids = self._imap_op(_setup)
        total = len(uids)

        for i in range(0, total, batch_size):
            batch = uids[i: i + batch_size]
            uid_str = ",".join(u.decode() for u in batch)
            _, fetch_data = self._mail.fetch(uid_str, "(RFC822)")
            for item in fetch_data:
                if isinstance(item, tuple):
                    uid = item[0].decode().split()[0]
                    try:
                        yield self._parse_message(item[1], uid, folder), total
                    except Exception as e:
                        print(f"[fetch_all] parse error uid={uid} folder={folder}: {e}")

    def fetch_recent_n(self, folder: str = "INBOX", n: int = 50, from_date=None):
        """Fetch the N most recent emails. Newest UIDs = newest emails in IMAP."""
        criteria = f'SINCE "{self._imap_date(from_date)}"' if from_date else "ALL"

        def _setup():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.search(None, criteria)
            return data[0].split()

        uids = self._imap_op(_setup)
        total = len(uids)
        recent = uids[-n:] if len(uids) > n else uids
        if not recent:
            return

        uid_str = ",".join(u.decode() for u in recent)
        _, fetch_data = self._mail.fetch(uid_str, "(RFC822)")
        for item in fetch_data:
            if isinstance(item, tuple):
                uid = item[0].decode().split()[0]
                try:
                    yield self._parse_message(item[1], uid, folder), total
                except Exception as e:
                    print(f"[fetch_recent_n] parse error uid={uid} folder={folder}: {e}")

    def fetch_one(self, uid: str, folder: str = "INBOX") -> Optional[EmailMessage]:
        def _op():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.fetch(uid, "(RFC822)")
            for item in data:
                if isinstance(item, tuple):
                    return self._parse_message(item[1], uid, folder)
            return None
        return self._imap_op(_op)
