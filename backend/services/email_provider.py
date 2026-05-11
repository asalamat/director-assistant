import imaplib
import email as email_lib
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
import re
import html
from typing import AsyncIterator, Optional, List
from datetime import datetime
import httpx
import msal
import json
from pathlib import Path

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
        self._mail: Optional[imaplib.IMAP4_SSL] = None

    def connect(self):
        import socket as _socket
        old = _socket.getdefaulttimeout()
        _socket.setdefaulttimeout(IMAP_CONNECT_TIMEOUT)
        try:
            self._mail = imaplib.IMAP4_SSL(self.host, self.port, timeout=IMAP_CONNECT_TIMEOUT)
            self._mail.login(self.username, self.password)
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
        try:
            self.connect()
            self.disconnect()
            return True
        except Exception:
            return False

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

        body_text = plain
        if not body_text and html_body:
            body_text = _html_to_text(html_body)

        return EmailMessage(
            id=uid,
            subject=subject,
            sender=sender,
            recipients=recipients,
            date=date,
            body=body_text,
            body_html=html_body,
            thread_id=thread_id,
            folder=folder,
            is_read=True,
        )

    def list_folders(self) -> List[str]:
        if not self._mail:
            self.connect()
        _, folders = self._mail.list()
        result = []
        for f in folders:
            parts = f.decode().split('"/"')
            if parts:
                result.append(parts[-1].strip().strip('"'))
        return result

    def find_sent_folder(self) -> str:
        """Auto-detect the Sent folder name (varies by provider/locale)."""
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
        """Return the first candidate folder that actually exists, or None."""
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
        # Auto-detect bulk/spam — name varies by provider/locale
        bulk = self._find_folder([
            "Bulk Mail", "Bulk", "Spam", "Junk", "Junk Mail",
            "Junk E-mail", "JUNK", "SPAM",
        ])
        if bulk:
            folders.append(bulk)
        return folders

    def search_by_subject(self, subject: str, folder: str = "INBOX", limit: int = 10):
        """Search IMAP folder for emails matching subject. Yields (EmailMessage, total)."""
        if not self._mail:
            self.connect()
        self._mail.select(f'"{folder}"')
        safe = subject.replace('"', '')
        _, data = self._mail.search(None, f'SUBJECT "{safe}"')
        uids = data[0].split()
        total = len(uids)
        recent = uids[-limit:] if len(uids) > limit else uids
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
        """Return the set of UIDs currently on the server (no body download).
        Used to detect deletions: UIDs in our cache but not here were removed.
        """
        if not self._mail:
            self.connect()
        self._mail.select(f'"{folder}"')
        criteria = f'SINCE "{self._imap_date(from_date)}"' if from_date else "ALL"
        _, data = self._mail.search(None, criteria)
        return {u.decode() for u in data[0].split() if u}

    @staticmethod
    def _imap_date(dt) -> str:
        """Convert date to IMAP SINCE format: 01-Jan-2024"""
        months = ["Jan","Feb","Mar","Apr","May","Jun",
                  "Jul","Aug","Sep","Oct","Nov","Dec"]
        return f"{dt.day:02d}-{months[dt.month-1]}-{dt.year}"

    def fetch_all(self, folder: str = "INBOX", batch_size: int = 100, from_date=None):
        """Yield EmailMessage objects for every email in folder.
        from_date: optional datetime — only fetch emails on/after this date.
        """
        if not self._mail:
            self.connect()
        self._mail.select(f'"{folder}"')

        if from_date:
            criteria = f'SINCE "{self._imap_date(from_date)}"'
        else:
            criteria = "ALL"

        _, data = self._mail.search(None, criteria)
        uids = data[0].split()
        total = len(uids)

        for i in range(0, total, batch_size):
            batch = uids[i: i + batch_size]
            uid_str = ",".join(u.decode() for u in batch)
            _, fetch_data = self._mail.fetch(uid_str, "(RFC822)")
            for item in fetch_data:
                if isinstance(item, tuple):
                    uid = item[0].decode().split()[0]
                    try:
                        msg = self._parse_message(item[1], uid, folder)
                        yield msg, total
                    except Exception as e:
                        print(f"[fetch_all] parse error uid={uid} folder={folder}: {e}")
                        continue

    def fetch_recent_n(self, folder: str = "INBOX", n: int = 50, from_date=None):
        """Fetch the N most recent emails (newest UIDs first).
        Used for polling so we always check the latest arrivals, not the oldest.
        from_date: datetime — server-side SINCE filter narrows the UID list cheaply.
        """
        if not self._mail:
            self.connect()
        self._mail.select(f'"{folder}"')

        criteria = f'SINCE "{self._imap_date(from_date)}"' if from_date else "ALL"
        _, data = self._mail.search(None, criteria)
        uids = data[0].split()
        total = len(uids)

        # Take the LAST n UIDs (highest UID = newest email in IMAP)
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
                    continue

    def fetch_one(self, uid: str, folder: str = "INBOX") -> Optional[EmailMessage]:
        if not self._mail:
            self.connect()
        self._mail.select(f'"{folder}"')
        _, data = self._mail.fetch(uid, "(RFC822)")
        for item in data:
            if isinstance(item, tuple):
                return self._parse_message(item[1], uid, folder)
        return None


class Office365Provider:
    """Microsoft Graph API provider for Office 365."""

    BASE_URL = "https://graph.microsoft.com/v1.0"

    def __init__(self, config: ConnectionConfig):
        self.config = config
        self._token: Optional[str] = None

    def _get_token(self) -> str:
        if self.config.access_token:
            return self.config.access_token

        authority = f"https://login.microsoftonline.com/{self.config.tenant_id}"
        app = msal.ConfidentialClientApplication(
            self.config.client_id,
            authority=authority,
            client_credential=self.config.client_secret,
        )
        result = app.acquire_token_for_client(
            scopes=["https://graph.microsoft.com/.default"]
        )
        if "access_token" not in result:
            raise ValueError(f"Auth failed: {result.get('error_description')}")
        return result["access_token"]

    def test_connection(self) -> bool:
        try:
            token = self._get_token()
            with httpx.Client() as client:
                r = client.get(
                    f"{self.BASE_URL}/me",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
            return r.status_code == 200
        except Exception:
            return False

    def _parse_graph_message(self, msg: dict, folder: str) -> EmailMessage:
        sender_obj = msg.get("from", {}).get("emailAddress", {})
        sender = sender_obj.get("address", sender_obj.get("name", ""))

        recipients = [
            r["emailAddress"]["address"]
            for r in msg.get("toRecipients", [])
            if "emailAddress" in r
        ]

        date = None
        date_str = msg.get("receivedDateTime", "")
        if date_str:
            try:
                date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            except Exception:
                pass

        body_content = msg.get("body", {}).get("content", "")
        body_type = msg.get("body", {}).get("contentType", "text")
        plain = None
        html_body = None
        if body_type == "html":
            html_body = body_content
            plain = _html_to_text(body_content)
        else:
            plain = body_content

        return EmailMessage(
            id=msg["id"],
            subject=msg.get("subject", ""),
            sender=sender,
            recipients=recipients,
            date=date,
            body=plain,
            body_html=html_body,
            thread_id=msg.get("conversationId", msg["id"]),
            folder=folder,
            is_read=msg.get("isRead", True),
        )

    def get_ingest_folders(self) -> List[str]:
        """Inbox + Sent using Graph API well-known folder names."""
        return ["inbox", "sentitems"]

    def fetch_all(self, folder: str = "inbox", batch_size: int = 100, from_date=None):
        """Yield (EmailMessage, total) tuples using Graph API pagination.
        from_date: optional datetime — only fetch emails on/after this date.
        """
        token = self._get_token()
        fields = "id,subject,from,toRecipients,receivedDateTime,body,conversationId,isRead"
        date_filter = ""
        if from_date:
            iso = from_date.strftime("%Y-%m-%dT00:00:00Z")
            date_filter = f"&$filter=receivedDateTime ge {iso}"
        url = (
            f"{self.BASE_URL}/me/mailFolders/{folder}/messages"
            f"?$top={batch_size}&$select={fields}{date_filter}"
        )
        total = None

        with httpx.Client(timeout=30) as client:
            while url:
                r = client.get(url, headers={"Authorization": f"Bearer {token}"})
                r.raise_for_status()
                data = r.json()

                if total is None:
                    count_url = f"{self.BASE_URL}/me/mailFolders/{folder}/messages/$count"
                    cr = client.get(count_url, headers={
                        "Authorization": f"Bearer {token}",
                        "ConsistencyLevel": "eventual",
                    })
                    try:
                        total = int(cr.text)
                    except Exception:
                        total = 0

                for msg in data.get("value", []):
                    try:
                        yield self._parse_graph_message(msg, folder), total
                    except Exception:
                        continue

                url = data.get("@odata.nextLink")

    def get_uid_list(self, folder: str = "inbox", from_date=None) -> set:
        """Return the set of Graph message IDs currently on the server (ID only, no body).
        Used for deletion detection — does NOT download message content.
        """
        token = self._get_token()
        date_filter = ""
        if from_date:
            iso = from_date.strftime("%Y-%m-%dT00:00:00Z")
            date_filter = f"&$filter=receivedDateTime ge {iso}"
        url = (
            f"{self.BASE_URL}/me/mailFolders/{folder}/messages"
            f"?$top=1000&$select=id{date_filter}"
        )
        ids: set = set()
        with httpx.Client(timeout=30) as client:
            while url:
                try:
                    r = client.get(url, headers={"Authorization": f"Bearer {token}"})
                    r.raise_for_status()
                    data = r.json()
                    for msg in data.get("value", []):
                        if msg.get("id"):
                            ids.add(msg["id"])
                    url = data.get("@odata.nextLink")
                except Exception:
                    break
        return ids

    def fetch_one(self, msg_id: str) -> Optional[EmailMessage]:
        token = self._get_token()
        fields = "id,subject,from,toRecipients,receivedDateTime,body,conversationId,isRead"
        with httpx.Client(timeout=30) as client:
            r = client.get(
                f"{self.BASE_URL}/me/messages/{msg_id}?$select={fields}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code != 200:
                return None
            return self._parse_graph_message(r.json(), "inbox")


def build_provider(config: ConnectionConfig):
    if config.provider == EmailProviderType.OFFICE365:
        return Office365Provider(config)
    return IMAPProvider(config)    # covers yahoo_imap, gmail, hotmail, generic_imap
