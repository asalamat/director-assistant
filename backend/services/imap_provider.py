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
            try:
                result.append(text.decode(charset or "utf-8", errors="replace"))
            except (LookupError, UnicodeDecodeError):
                result.append(text.decode("latin-1", errors="replace"))
        else:
            result.append(text)
    return "".join(result)


def _html_to_text(html_body: str) -> str:
    text = re.sub(r'<br\s*/?>', '\n', html_body, flags=re.IGNORECASE)
    text = re.sub(r'<p[^>]*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def _safe_decode(payload: bytes, charset: str) -> str:
    """Decode bytes with fallback to latin-1 when the charset name is unknown."""
    try:
        return payload.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        return payload.decode("latin-1", errors="replace")


_IMAGE_TYPES = frozenset({"image/jpeg", "image/jpg", "image/png", "image/gif",
                           "image/webp", "image/bmp", "image/tiff"})

_EXT_TO_CT = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc":  "application/msword",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls":  "application/vnd.ms-excel",
    ".txt":  "text/plain",
    ".csv":  "text/plain",
}


def _resolve_ct(ct: str, filename: str) -> str:
    """Use filename extension to fix generic application/octet-stream content-types."""
    if ct != "application/octet-stream":
        return ct
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    return _EXT_TO_CT.get(ext, ct)


def _extract_attachment_text(part) -> Optional[str]:
    """Extract readable text from common attachment types; note images by name."""
    filename = _decode_mime_header(part.get_filename() or "") or ""
    ct = _resolve_ct(part.get_content_type(), filename)
    filename = filename or "attachment"

    # Images: we can't read pixels, but note the filename so the AI is aware
    if ct in _IMAGE_TYPES or ct.startswith("image/"):
        return f"[Image attachment: {filename}]"

    payload = part.get_payload(decode=True)
    if not payload:
        return None

    text = None

    if ct == "text/plain":
        charset = part.get_content_charset() or "utf-8"
        text = _safe_decode(payload, charset)

    elif ct == "text/html":
        charset = part.get_content_charset() or "utf-8"
        raw = _safe_decode(payload, charset)
        text = re.sub(r'<[^>]+>', ' ', raw)
        text = re.sub(r'\s+', ' ', text).strip()

    elif ct == "application/pdf":
        try:
            import io
            from pdfminer.high_level import extract_text as pdf_extract
            text = pdf_extract(io.BytesIO(payload))
        except Exception:
            return f"[PDF attachment: {filename} — could not extract text]"

    elif ct in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    ):
        try:
            import io
            from docx import Document
            doc = Document(io.BytesIO(payload))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception:
            return f"[Word attachment: {filename} — could not extract text]"

    elif ct in (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ):
        try:
            import io
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
            rows = []
            for ws in wb.worksheets:
                for row in ws.iter_rows(values_only=True):
                    line = "\t".join(str(c) for c in row if c is not None)
                    if line.strip():
                        rows.append(line)
                    if len(rows) >= 200:
                        break
                if len(rows) >= 200:
                    break
            text = "\n".join(rows)
        except Exception:
            return f"[Excel attachment: {filename} — could not extract text]"

    if not text or not text.strip():
        return None

    return f"[Attachment: {filename}]\n{text.strip()[:3000]}"


def _is_attachment_part(part) -> bool:
    """Detect attachment parts including inline-with-filename."""
    cd = str(part.get("Content-Disposition", ""))
    if "attachment" in cd:
        return True
    # Inline parts with an explicit filename are effectively attachments
    if part.get_filename():
        ct = part.get_content_type()
        # Don't treat inline text/plain or text/html without disposition as attachments
        if ct not in ("text/plain", "text/html") or "inline" not in cd:
            return True
    return False


def _extract_body(msg) -> tuple[Optional[str], Optional[str]]:
    plain = None
    html_body = None
    attachment_texts: list[str] = []

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if _is_attachment_part(part):
                att = _extract_attachment_text(part)
                if att:
                    attachment_texts.append(att)
                continue
            if ct == "text/plain" and plain is None:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    plain = _safe_decode(payload, charset)
            elif ct == "text/html" and html_body is None:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    html_body = _safe_decode(payload, charset)
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            ct = msg.get_content_type()
            if ct == "text/html":
                html_body = _safe_decode(payload, charset)
            else:
                plain = _safe_decode(payload, charset)

    if attachment_texts:
        suffix = "\n\n" + "\n\n".join(attachment_texts)
        if plain is not None:
            plain = plain + suffix
        else:
            plain = suffix.strip()

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
                # OAuth2 / Modern Auth — works with Microsoft accounts that have disabled basic auth.
                # imaplib._Authenticator.encode() base64-encodes the callback return value,
                # so we must return RAW bytes (not pre-base64 string).
                xoauth2_raw = f"user={self.username}\x01auth=Bearer {self.access_token}\x01\x01".encode()
                calls = []
                def _xoauth2_cb(challenge):
                    if not calls:          # first call — send credentials
                        calls.append(1)
                        return xoauth2_raw
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
                    return b""             # must send empty to complete SASL exchange
                self._mail.authenticate("XOAUTH2", _xoauth2_cb)
            else:
                try:
                    self._mail.login(self.username, password)
                except imaplib.IMAP4.error:
                    # Fallback: some servers reject LOGIN but accept AUTHENTICATE PLAIN
                    creds = f"\x00{self.username}\x00{password}".encode()
                    self._mail.authenticate(
                        "PLAIN", lambda _: creds
                    )
        except Exception:
            self._mail = None  # never leave a stale unauthenticated connection
            raise
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

    def save_draft(self, to: str, subject: str, body: str) -> bool:
        """Append an RFC-2822 message to the Drafts folder. Returns True on success."""
        import email.utils as _eu
        from email.mime.text import MIMEText
        draft_folders = ["[Gmail]/Drafts", "Drafts", "INBOX.Drafts", "Draft"]
        try:
            self._imap_op(lambda: None)  # ensure connected
            # Discover actual Drafts folder name
            status, folders = self._mail.list()
            drafts = None
            if status == "OK":
                for f in folders:
                    decoded = f.decode() if isinstance(f, bytes) else f
                    lower = decoded.lower()
                    if "draft" in lower:
                        # extract folder name after the last space or quote
                        m = re.search(r'"([^"]+)"\s*$|(\S+)\s*$', decoded)
                        if m:
                            drafts = (m.group(1) or m.group(2)).strip('"')
                            break
            if not drafts:
                drafts = draft_folders[0]

            msg = MIMEText(body, "plain", "utf-8")
            msg["From"] = self.username
            msg["To"] = to
            msg["Subject"] = subject
            msg["Date"] = _eu.formatdate()
            msg["Message-ID"] = _eu.make_msgid()

            self._mail.append(drafts, r"\Draft", None, msg.as_bytes())
            return True
        except Exception as e:
            print(f"[draft] save failed: {e}")
            return False

    @staticmethod
    def _seen_from_header(header: str) -> bool:
        """Return True if the IMAP FLAGS response contains \\Seen."""
        m = re.search(r'FLAGS\s*\(([^)]*)\)', header, re.IGNORECASE)
        if not m:
            return True  # unknown — assume read
        return r'\Seen' in m.group(1) or '\\seen' in m.group(1).lower()

    def _imap_op(self, fn):
        """Run fn() with one automatic reconnect if the server dropped the connection."""
        if self._mail is None:
            self.connect()
        try:
            return fn()
        except (imaplib.IMAP4.abort, imaplib.IMAP4.error, SystemError, OSError, TimeoutError):
            # OSError/TimeoutError: socket timed out — dead socket must be replaced before retry
            self._mail = None
            self.connect()
            return fn()

    def _parse_message(self, raw: bytes, uid: str, folder: str, is_read: bool = True) -> EmailMessage:
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
            is_read=is_read,
        )

    def list_folders(self) -> List[str]:
        def _op():
            _, folders = self._mail.list()
            result = []
            for f in (folders or []):
                if not f:
                    continue
                raw = f.decode() if isinstance(f, bytes) else str(f)
                # LIST response format: (\Flags) "separator" "folder name"
                # Extract the last quoted token or unquoted trailing word
                m = re.search(r'"([^"]+)"\s*$', raw) or re.search(r'(\S+)\s*$', raw)
                if m:
                    result.append(m.group(1).strip('"'))
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
        """All folders on the server except Junk/Trash/Drafts (used for initial full ingest)."""
        _SKIP = {
            "junk", "junk mail", "junk e-mail", "spam", "bulk", "bulk mail",
            "trash", "deleted", "deleted items", "deleted messages",
            "drafts", "draft",
        }
        try:
            all_folders = self.list_folders()
        except Exception:
            all_folders = ["INBOX"]

        kept: list[str] = []
        for f in all_folders:
            if f.lower().strip('"') not in _SKIP:
                kept.append(f)

        if not kept:
            kept = ["INBOX"]
        return kept

    def get_poll_folders(self) -> List[str]:
        """Folders to check on each poll cycle — hardcoded standard names only.

        Skips IMAP LIST entirely; providers with 150+ folders (e.g. Yahoo) would
        otherwise take 120+ seconds just to enumerate. Missing folders are
        handled gracefully by the caller.
        """
        return ["INBOX", "Sent", "Sent Items", "Sent Mail"]

    def search_by_subject(self, subject: str, folder: str = "INBOX", limit: int = 10):
        """Search IMAP folder for emails matching subject. Yields (EmailMessage, total)."""
        safe = subject.replace('"', '')

        def _setup():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.uid("SEARCH", None, f'SUBJECT "{safe}"')
            uids = (data[0] or b"").split()
            recent = uids[-limit:] if len(uids) > limit else uids
            return uids, recent

        uids, recent = self._imap_op(_setup)
        total = len(uids)
        if not recent:
            return
        uid_str = b",".join(recent).decode()
        _, fetch_data = self._mail.uid("FETCH", uid_str, "(FLAGS RFC822)")
        for item in fetch_data:
            if isinstance(item, tuple):
                header = item[0].decode()
                uid_match = re.search(r"UID (\d+)", header)
                uid = uid_match.group(1) if uid_match else header.split()[0]
                try:
                    yield self._parse_message(item[1], uid, folder, self._seen_from_header(header)), total
                except Exception as e:
                    print(f"[provider] parse error uid={uid}: {e}")

    def get_uid_list(self, folder: str = "INBOX", from_date=None) -> set:
        """Return stable server UIDs for the folder. Used for deletion detection."""
        criteria = f'SINCE "{self._imap_date(from_date)}"' if from_date else "ALL"

        def _op():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.uid("SEARCH", None, criteria)
            return {u.decode() for u in (data[0] or b"").split() if u}

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
            _, data = self._mail.uid("SEARCH", None, criteria)
            return (data[0] or b"").split()

        uids = self._imap_op(_setup)
        total = len(uids)

        for i in range(0, total, batch_size):
            batch = uids[i: i + batch_size]
            uid_str = b",".join(batch).decode()
            try:
                _, fetch_data = self._mail.uid("FETCH", uid_str, "(FLAGS RFC822)")
            except (imaplib.IMAP4.abort, OSError, TimeoutError):
                self._mail = None
                self.connect()
                self._mail.select(f'"{folder}"')
                _, fetch_data = self._mail.uid("FETCH", uid_str, "(FLAGS RFC822)")
            except (SystemError, ValueError):
                # Python 3.13 memoryview bug in batch response — fall back to one-at-a-time
                fetch_data = []
                for single_uid in batch:
                    if self._mail is None:
                        break
                    try:
                        _, d = self._mail.uid("FETCH", single_uid.decode(), "(FLAGS RFC822)")
                        fetch_data.extend(d)
                    except (imaplib.IMAP4.abort, OSError, TimeoutError):
                        try:
                            self._mail = None
                            self.connect()
                            self._mail.select(f'"{folder}"')
                        except Exception:
                            break
                    except (SystemError, ValueError):
                        pass  # skip this one email, continue with the rest
                    except Exception:
                        pass
            for item in fetch_data:
                if isinstance(item, tuple):
                    try:
                        header = item[0].decode()
                        uid_match = re.search(r"UID (\d+)", header)
                        uid = uid_match.group(1) if uid_match else header.split()[0]
                        yield self._parse_message(item[1], uid, folder, self._seen_from_header(header)), total
                    except Exception as e:
                        print(f"[fetch_all] parse/decode error folder={folder}: {e}")

    def fetch_recent_n(self, folder: str = "INBOX", n: int = 50, from_date=None):
        """Fetch the N most recent emails using stable UIDs."""
        criteria = f'SINCE "{self._imap_date(from_date)}"' if from_date else "ALL"

        def _setup():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.uid("SEARCH", None, criteria)
            return (data[0] or b"").split()

        uids = self._imap_op(_setup)
        total = len(uids)
        recent = uids[-n:] if len(uids) > n else uids
        if not recent:
            return

        uid_str = b",".join(recent).decode()
        try:
            _, fetch_data = self._mail.uid("FETCH", uid_str, "(FLAGS RFC822)")
        except imaplib.IMAP4.abort:
            self._mail = None
            self.connect()
            self._mail.select(f'"{folder}"')
            _, fetch_data = self._mail.uid("FETCH", uid_str, "(FLAGS RFC822)")
        except (SystemError, ValueError):
            # Python 3.13 memoryview bug in batch response — fall back to one-at-a-time
            # on the SAME connection (the connection itself is fine)
            fetch_data = []
            for single_uid in recent:
                if self._mail is None:
                    break
                try:
                    _, d = self._mail.uid("FETCH", single_uid.decode(), "(FLAGS RFC822)")
                    fetch_data.extend(d)
                except imaplib.IMAP4.abort:
                    try:
                        self._mail = None
                        self.connect()
                        self._mail.select(f'"{folder}"')
                    except Exception:
                        break
                except (SystemError, ValueError):
                    pass  # skip this one email, continue with the rest
                except Exception:
                    pass
        for item in fetch_data:
            if isinstance(item, tuple):
                try:
                    header = item[0].decode()
                    uid_match = re.search(r"UID (\d+)", header)
                    uid = uid_match.group(1) if uid_match else header.split()[0]
                    yield self._parse_message(item[1], uid, folder, self._seen_from_header(header)), total
                except Exception as e:
                    print(f"[fetch_recent_n] parse/decode error folder={folder}: {e}")

    def fetch_one(self, uid: str, folder: str = "INBOX") -> Optional[EmailMessage]:
        def _op():
            self._mail.select(f'"{folder}"')
            _, data = self._mail.uid("FETCH", uid, "(FLAGS RFC822)")
            for item in data:
                if isinstance(item, tuple):
                    header = item[0].decode()
                    return self._parse_message(item[1], uid, folder, self._seen_from_header(header))
            return None
        return self._imap_op(_op)
