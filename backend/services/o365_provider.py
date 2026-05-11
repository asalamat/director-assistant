"""
Office 365 / Microsoft Graph API email provider.
"""

from typing import Optional, List
from datetime import datetime

import httpx
import msal

from models import EmailMessage, ConnectionConfig
from services.imap_provider import _html_to_text


class Office365Provider:
    """Microsoft Graph API provider for Office 365."""

    BASE_URL = "https://graph.microsoft.com/v1.0"

    def __init__(self, config: ConnectionConfig):
        self.config = config

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
        return ["inbox", "sentitems"]

    def fetch_all(self, folder: str = "inbox", batch_size: int = 100, from_date=None):
        """Yield (EmailMessage, total) using Graph API pagination."""
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
                    count_url = (
                        f"{self.BASE_URL}/me/mailFolders/{folder}/messages/$count"
                    )
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
        """Return Graph message IDs on the server (IDs only, no body download)."""
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

    def fetch_one(self, msg_id: str, folder: str = "inbox") -> Optional[EmailMessage]:
        token = self._get_token()
        fields = "id,subject,from,toRecipients,receivedDateTime,body,conversationId,isRead"
        with httpx.Client(timeout=30) as client:
            r = client.get(
                f"{self.BASE_URL}/me/messages/{msg_id}?$select={fields}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if r.status_code != 200:
                return None
            return self._parse_graph_message(r.json(), folder)
