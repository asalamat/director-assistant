from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from enum import Enum


class EmailProviderType(str, Enum):
    YAHOO_IMAP = "yahoo_imap"
    GENERIC_IMAP = "generic_imap"
    OFFICE365 = "office365"


class EmailMessage(BaseModel):
    id: str
    subject: str = ""
    sender: str = ""
    recipients: List[str] = []
    date: Optional[datetime] = None
    body: Optional[str] = None
    body_html: Optional[str] = None
    thread_id: Optional[str] = None
    folder: str = "INBOX"
    is_read: bool = True


class EmailSummary(BaseModel):
    id: str
    subject: str = ""
    sender: str = ""
    date: Optional[str] = None
    preview: str = ""
    is_read: bool = True


class AIRecommendation(BaseModel):
    suggested_replies: List[str] = []
    key_points: List[str] = []
    tone: str = "neutral"
    action_items: List[str] = []
    similar_emails: List[EmailSummary] = []
    urgency: str = "medium"
    analysis: str = ""


class ConnectionConfig(BaseModel):
    provider: EmailProviderType
    username: str
    password: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: int = 993
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    tenant_id: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None


class IngestRequest(BaseModel):
    from_date: Optional[str] = None   # ISO date string, e.g. "2024-01-01"
    folders: Optional[List[str]] = None  # override auto-detected folders


class IngestProgress(BaseModel):
    total: int = 0
    processed: int = 0
    status: str = "idle"
    message: str = ""
    from_date: Optional[str] = None   # echoed back so UI can display it


class EmailListResponse(BaseModel):
    emails: List[EmailSummary]
    total: int
    has_more: bool


class SearchRequest(BaseModel):
    query: str
    n_results: int = 10
    folder: Optional[str] = None
