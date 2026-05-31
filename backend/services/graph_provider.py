"""
Microsoft Graph API email provider.
Used for accounts that authenticated via OAuth device flow (access_token, no IMAP password).
Replaces IMAP for email fetching — everything goes through https://graph.microsoft.com/v1.0/me/
"""

from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from typing import List, Optional

import httpx

from models import ConnectionConfig, EmailMessage

_GRAPH = "https://graph.microsoft.com/v1.0/me"

_SKIP_FOLDERS = {
    "junk email", "junk", "spam", "trash", "deleted items",
    "deleted messages", "drafts", "outbox",
}

_MSG_SELECT = (
    "id,subject,from,toRecipients,receivedDateTime,"
    "body,isRead,conversationId,hasAttachments"
)


def _strip_html(raw: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
    text = re.sub(r"<p[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


class GraphMailProvider:
    """Email provider backed by Microsoft Graph REST API."""

    def __init__(self, config: ConnectionConfig):
        self._token = config.access_token or ""
        self.username = config.username
        self._folder_cache: dict[str, str] = {}  # displayName → id

    # ── internal ──────────────────────────────────────────────────────────────

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}", "Accept": "application/json"}

    def _get(self, path: str, params: dict | None = None) -> dict:
        url = path if path.startswith("http") else f"{_GRAPH}/{path.lstrip('/')}"
        r = httpx.get(url, headers=self._headers(), params=params, timeout=20)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, json: dict) -> dict:
        url = path if path.startswith("http") else f"{_GRAPH}/{path.lstrip('/')}"
        r = httpx.post(url, headers=self._headers(), json=json, timeout=20)
        r.raise_for_status()
        return r.json()

    def _load_folders(self) -> None:
        data = self._get("mailFolders", {"$top": "100", "$select": "id,displayName"})
        for f in data.get("value", []):
            self._folder_cache[f["displayName"].lower()] = f["id"]
            self._folder_cache[f["displayName"]] = f["id"]

    def _folder_id(self, name: str) -> str:
        """Resolve a display name to a Graph folder ID."""
        if not self._folder_cache:
            self._load_folders()
        # exact match first, then case-insensitive
        return (
            self._folder_cache.get(name)
            or self._folder_cache.get(name.lower())
            or name  # Graph also accepts well-known names like 'inbox'
        )

    def _parse_message(self, msg: dict, folder: str) -> EmailMessage:
        sender = ""
        fr = msg.get("from") or {}
        ea = (fr.get("emailAddress") or {})
        addr = ea.get("address", "")
        dname = ea.get("name", "")
        sender = f"{dname} <{addr}>" if dname and dname != addr else addr

        recipients = []
        for r in msg.get("toRecipients") or []:
            a = (r.get("emailAddress") or {}).get("address", "")
            if a:
                recipients.append(a)

        body_obj = msg.get("body") or {}
        raw_body = body_obj.get("content", "")
        if body_obj.get("contentType", "").lower() == "html":
            body = _strip_html(raw_body)
            body_html = raw_body
        else:
            body = raw_body
            body_html = None

        date_str = msg.get("receivedDateTime", "")
        parsed_date: Optional[datetime] = None
        if date_str:
            try:
                parsed_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            except ValueError:
                parsed_date = None

        return EmailMessage(
            id=msg["id"],
            server_id=msg["id"],
            subject=msg.get("subject", "") or "",
            sender=sender,
            recipients=recipients,
            date=parsed_date,
            body=body,
            body_html=body_html,
            thread_id=msg.get("conversationId"),
            folder=folder,
            is_read=msg.get("isRead", True),
        )

    # ── provider interface ────────────────────────────────────────────────────

    def test_connection(self) -> bool:
        """Validate the access token with a lightweight GET /me call."""
        r = httpx.get(_GRAPH, headers=self._headers(), timeout=10)
        if r.status_code == 401:
            raise ConnectionError("Microsoft token expired or invalid — please re-authenticate")
        r.raise_for_status()
        return True

    def get_ingest_folders(self) -> List[str]:
        """Return all mail folders except junk/trash/drafts."""
        try:
            data = self._get("mailFolders", {"$top": "100", "$select": "id,displayName"})
        except Exception:
            return ["Inbox"]

        kept: list[str] = []
        for f in data.get("value", []):
            name = f.get("displayName", "")
            self._folder_cache[name.lower()] = f["id"]
            self._folder_cache[name] = f["id"]
            if name.lower() not in _SKIP_FOLDERS:
                kept.append(name)

        return kept or ["Inbox"]

    def get_poll_folders(self) -> List[str]:
        return ["Inbox", "Sent Items"]

    def fetch_all(self, folder: str = "Inbox", batch_size: int = 100, from_date=None):
        """Yield (EmailMessage, estimated_total) for all messages in a folder."""
        folder_id = self._folder_id(folder)

        params: dict = {
            "$select": _MSG_SELECT,
            "$top": str(min(batch_size, 100)),
            "$orderby": "receivedDateTime desc",
        }
        if from_date:
            if isinstance(from_date, datetime):
                dt_str = from_date.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                dt_str = str(from_date)
            params["$filter"] = f"receivedDateTime ge {dt_str}"

        url = f"mailFolders/{folder_id}/messages"
        total_estimate = 0
        yielded = 0

        while url:
            try:
                data = self._get(url, params if not url.startswith("http") else None)
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (403, 404):
                    break
                raise

            items = data.get("value", [])
            # On first page, estimate total from folder metadata
            if total_estimate == 0 and items:
                try:
                    fmeta = self._get(f"mailFolders/{folder_id}",
                                      {"$select": "totalItemCount"})
                    total_estimate = fmeta.get("totalItemCount", len(items))
                except Exception:
                    total_estimate = len(items)

            for msg in items:
                try:
                    em = self._parse_message(msg, folder)
                    yielded += 1
                    yield em, total_estimate
                except Exception as e:
                    print(f"[graph] parse error {msg.get('id')}: {e}")

            url = data.get("@odata.nextLink", "")
            params = {}  # nextLink already contains all query params

    def get_uid_list(self, folder: str = "Inbox", from_date=None) -> set:
        """Return set of message IDs in a folder (used for deletion detection)."""
        folder_id = self._folder_id(folder)
        params: dict = {"$select": "id", "$top": "1000"}
        if from_date:
            if isinstance(from_date, datetime):
                dt_str = from_date.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                dt_str = str(from_date)
            params["$filter"] = f"receivedDateTime ge {dt_str}"

        ids: set = set()
        url = f"mailFolders/{folder_id}/messages"
        while url:
            try:
                data = self._get(url, params if not url.startswith("http") else None)
            except Exception:
                break
            for msg in data.get("value", []):
                ids.add(msg["id"])
            url = data.get("@odata.nextLink", "")
            params = {}
        return ids

    def save_draft(self, to: str, subject: str, body: str) -> bool:
        """Create a draft message in the Drafts folder via Graph API."""
        try:
            payload: dict = {
                "subject": subject[:998],
                "body": {"contentType": "Text", "content": body},
                "isDraft": True,
            }
            if to and "@" in to:
                payload["toRecipients"] = [{"emailAddress": {"address": to}}]
            self._post("mailFolders/drafts/messages", payload)
            return True
        except Exception as e:
            print(f"[graph] save_draft failed: {e}")
            return False
