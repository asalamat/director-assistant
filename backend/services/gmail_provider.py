"""
Google Gmail REST API email provider.
Used for accounts authenticated via Google OAuth2 (access_token, no IMAP password).
"""

from __future__ import annotations

import base64
import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import List, Optional, Set

import httpx

from models import ConnectionConfig, EmailMessage

_GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"

_SKIP_LABELS: Set[str] = {
    "TRASH", "SPAM", "DRAFT",
}

_SYSTEM_LABELS: Set[str] = {
    "TRASH", "SPAM", "DRAFT", "SENT", "STARRED", "IMPORTANT",
    "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES",
    "CATEGORY_FORUMS", "CATEGORY_PERSONAL",
}


def _strip_html(raw: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
    text = re.sub(r"<p[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _b64decode(data: str) -> str:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")


class GmailProvider:
    """Email provider backed by Google Gmail REST API."""

    def __init__(self, config: ConnectionConfig):
        self._token = config.access_token or ""
        self.username = config.username
        self._label_cache: dict[str, str] = {}  # display name → label id

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}

    def _get(self, path: str, params: dict | None = None) -> dict:
        url = path if path.startswith("http") else f"{_GMAIL}/{path.lstrip('/')}"
        r = httpx.get(url, headers=self._headers(), params=params, timeout=20)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, json: dict) -> dict:
        url = path if path.startswith("http") else f"{_GMAIL}/{path.lstrip('/')}"
        r = httpx.post(url, headers=self._headers(), json=json, timeout=20)
        r.raise_for_status()
        return r.json()

    def _load_labels(self) -> None:
        data = self._get("labels")
        for lbl in data.get("labels", []):
            name = lbl.get("name", "")
            lid = lbl.get("id", "")
            self._label_cache[name] = lid
            self._label_cache[name.upper()] = lid

    def _label_id(self, name: str) -> str:
        if not self._label_cache:
            self._load_labels()
        return (
            self._label_cache.get(name)
            or self._label_cache.get(name.upper())
            or name  # Gmail also accepts label IDs directly (INBOX, SENT, etc.)
        )

    def _extract_body(self, payload: dict) -> tuple[str, Optional[str]]:
        """Return (plain_text, html_text) from a message payload."""
        mime = payload.get("mimeType", "")
        body_data = payload.get("body", {}).get("data", "")

        if mime == "text/plain" and body_data:
            return _b64decode(body_data), None
        if mime == "text/html" and body_data:
            raw = _b64decode(body_data)
            return _strip_html(raw), raw

        if "multipart" in mime:
            plain, html_body = "", None
            for part in payload.get("parts", []):
                p, h = self._extract_body(part)
                if p and not plain:
                    plain = p
                if h and not html_body:
                    html_body = h
            return plain, html_body

        return "", None

    def _parse_message(self, msg: dict, folder: str) -> EmailMessage:
        payload = msg.get("payload") or {}
        headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}

        subject = headers.get("subject", "")
        sender = headers.get("from", "")
        to = headers.get("to", "")
        date_str = headers.get("date", "")

        recipients = [a.strip() for a in to.split(",") if a.strip()] if to else []

        parsed_date: Optional[datetime] = None
        if date_str:
            try:
                parsed_date = parsedate_to_datetime(date_str)
            except Exception:
                pass

        body, body_html = self._extract_body(payload)

        return EmailMessage(
            id=msg["id"],
            server_id=msg["id"],
            subject=subject,
            sender=sender,
            recipients=recipients,
            date=parsed_date,
            body=body or None,
            body_html=body_html,
            thread_id=msg.get("threadId"),
            folder=folder,
            is_read="UNREAD" not in msg.get("labelIds", []),
        )

    # ── provider interface ────────────────────────────────────────────────────

    def test_connection(self) -> bool:
        r = httpx.get(f"{_GMAIL}/profile", headers=self._headers(), timeout=10)
        if r.status_code == 401:
            raise ConnectionError("Google token expired or invalid — please re-authenticate")
        r.raise_for_status()
        return True

    def get_ingest_folders(self) -> List[str]:
        try:
            data = self._get("labels")
        except Exception:
            return ["INBOX"]
        kept: list[str] = []
        for lbl in data.get("labels", []):
            name = lbl.get("name", "")
            lid = lbl.get("id", "")
            self._label_cache[name] = lid
            self._label_cache[name.upper()] = lid
            if lid not in _SKIP_LABELS and name.upper() not in _SKIP_LABELS:
                kept.append(name)
        return kept or ["INBOX"]

    def get_poll_folders(self) -> List[str]:
        return ["INBOX", "SENT"]

    def get_uid_list(self, folder: str = "INBOX", from_date=None) -> set:
        label_id = self._label_id(folder)
        params: dict = {"labelIds": label_id, "maxResults": "500", "fields": "messages/id,nextPageToken"}
        if from_date:
            if isinstance(from_date, datetime):
                epoch = int(from_date.replace(tzinfo=timezone.utc).timestamp())
                params["q"] = f"after:{epoch}"
        ids: set = set()
        page_token = None
        while True:
            if page_token:
                params["pageToken"] = page_token
            try:
                data = self._get("messages", params)
            except Exception:
                break
            for m in data.get("messages", []):
                ids.add(m["id"])
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return ids

    def fetch_all(self, folder: str = "INBOX", batch_size: int = 100, from_date=None):
        label_id = self._label_id(folder)
        params: dict = {"labelIds": label_id, "maxResults": str(min(batch_size, 500))}
        if from_date:
            if isinstance(from_date, datetime):
                epoch = int(from_date.replace(tzinfo=timezone.utc).timestamp())
                params["q"] = f"after:{epoch}"

        page_token = None
        total_estimate = 0

        while True:
            if page_token:
                params["pageToken"] = page_token
            try:
                data = self._get("messages", params)
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (403, 404):
                    break
                raise

            items = data.get("messages", [])
            if not total_estimate:
                total_estimate = data.get("resultSizeEstimate", len(items))

            for ref in items:
                try:
                    msg = self._get(f"messages/{ref['id']}", {"format": "full"})
                    em = self._parse_message(msg, folder)
                    yield em, total_estimate
                except Exception as e:
                    print(f"[gmail] parse error {ref['id']}: {e}")

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    def save_draft(self, to: str, subject: str, body: str) -> bool:
        from email.mime.text import MIMEText
        msg = MIMEText(body)
        msg["To"] = to
        msg["Subject"] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        try:
            self._post("drafts", {"message": {"raw": raw}})
            return True
        except Exception as e:
            print(f"[gmail] save_draft failed: {e}")
            return False

    def disconnect(self) -> None:
        pass  # stateless HTTP — nothing to close
