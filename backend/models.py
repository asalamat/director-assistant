from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class EmailProviderType(str, Enum):
    YAHOO_IMAP = "yahoo_imap"
    GMAIL = "gmail"
    HOTMAIL = "hotmail"
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
    server_id: Optional[str] = None  # original provider ID before account prefix is added


class EmailSummary(BaseModel):
    id: str
    subject: str = ""
    sender: str = ""
    date: Optional[str] = None
    preview: str = ""
    is_read: bool = True
    category: Optional[str] = None


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


class Account(BaseModel):
    id: Optional[int] = None
    name: str = ""
    provider: EmailProviderType
    username: str
    password: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: int = 993
    tenant_id: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    access_token: Optional[str] = None
    active: bool = True
    last_ingested: Optional[str] = None
    created_at: Optional[str] = None

    def to_connection_config(self) -> "ConnectionConfig":
        return ConnectionConfig(
            provider=self.provider,
            username=self.username,
            password=self.password,
            imap_host=self.imap_host,
            imap_port=self.imap_port,
            tenant_id=self.tenant_id,
            client_id=self.client_id,
            client_secret=self.client_secret,
            access_token=self.access_token,
        )


# ── Productivity features ──────────────────────────────────────────────────────

class ActionItem(BaseModel):
    id: Optional[int] = None
    email_id: str
    email_subject: str = ""
    text: str
    done: bool = False
    created_at: Optional[str] = None


class FollowUp(BaseModel):
    id: Optional[int] = None
    email_id: str
    subject: str = ""
    sender: str = ""
    due_date: str                    # ISO date
    note: str = ""
    done: bool = False
    created_at: Optional[str] = None


class Template(BaseModel):
    id: Optional[int] = None
    name: str
    body: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class EmailCategory(str, Enum):
    ACTION_REQUIRED = "action_required"
    FYI = "fyi"
    NEWSLETTER = "newsletter"
    MEETING = "meeting"
    OTHER = "other"


class DigestResponse(BaseModel):
    date: str
    summary: str
    top_action_items: List[str] = []
    highlights: List[str] = []
    email_count: int = 0


class SenderStats(BaseModel):
    sender: str
    total_emails: int
    first_contact: Optional[str] = None
    last_contact: Optional[str] = None
    recent_subjects: List[str] = []


class AnalyticsPeriod(BaseModel):
    date: str
    count: int


class AnalyticsResponse(BaseModel):
    daily_volume: List[AnalyticsPeriod] = []
    top_senders: List[Dict[str, Any]] = []
    folder_breakdown: Dict[str, int] = {}
    total_emails: int = 0
