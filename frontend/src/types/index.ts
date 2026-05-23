export interface EmailSummary {
  id: string
  subject: string
  sender: string
  date: string | null
  preview: string
  is_read: boolean
}

export interface EmailMessage {
  id: string
  subject: string
  sender: string
  recipients: string[]
  date: string | null
  body: string | null
  body_html: string | null
  thread_id: string | null
  folder: string
  is_read: boolean
}

export interface AIRecommendation {
  suggested_replies: string[]
  key_points: string[]
  tone: string
  action_items: string[]
  similar_emails: EmailSummary[]
  urgency: 'low' | 'medium' | 'high' | 'critical'
  analysis: string
}

export interface IngestProgress {
  total: number
  processed: number
  status: 'idle' | 'running' | 'completed' | 'error'
  message: string
}

export interface ConnectionStatus {
  connected: boolean
  provider: string | null
}

export type EmailProvider = 'yahoo_imap' | 'gmail' | 'hotmail' | 'generic_imap' | 'office365'

export interface Account {
  id: number
  name: string
  provider: EmailProvider
  username: string
  active: boolean
  last_ingested: string | null
  created_at: string | null
}

export type EmailCategory = 'action_required' | 'meeting' | 'fyi' | 'newsletter' | 'other'

export interface ActionItem {
  id: number
  email_id: string
  email_subject: string
  text: string
  done: boolean
  created_at: string | null
}

export interface FollowUp {
  id: number
  email_id: string
  subject: string
  sender: string
  due_date: string
  note: string
  done: boolean
  created_at: string | null
}

export interface Template {
  id?: number
  name: string
  body: string
  created_at?: string
  updated_at?: string
}

export interface DigestResponse {
  date: string
  summary: string
  top_action_items: string[]
  highlights: string[]
  email_count: number
}

export interface SenderStats {
  sender: string
  total_emails: number
  first_contact: string | null
  last_contact: string | null
  recent_subjects: string[]
}

export interface AnalyticsPeriod {
  date: string
  count: number
}

export interface AnalyticsResponse {
  daily_volume: AnalyticsPeriod[]
  top_senders: { sender: string; count: number }[]
  folder_breakdown: Record<string, number>
  total_emails: number
}

export interface AppConfig {
  has_api_key: boolean
  api_key_preview: string
  has_openai_key: boolean
  openai_key_preview: string
  poll_interval_seconds: number
  budget_mode: boolean
  sync_window_days: number
}

export interface Person {
  email: string
  name: string
  sent_count: number
  received_count: number
  subjects: string[]
  last_contact: string
  score: number
}

export interface Cluster {
  id: string
  name: string
  description: string
  email_count: number
  last_activity: string
  keywords: string[]
  status: 'active' | 'dormant' | 'resolved'
}

export interface OpenLoop {
  type: 'commitment' | 'awaiting' | 'deadline'
  text: string
  sender: string
  date: string
  urgency: 'high' | 'medium' | 'low'
}

export interface TimelineEvent {
  id: string
  subject: string
  sender: string
  date: string
  snippet: string
}

export interface AskHistoryEntry {
  id: number
  timestamp: string
  question: string
  answer: string
  results_json: string
}

export interface EmailThread {
  thread_id: string
  subject: string
  participants: string[]
  latest_date: string
  message_count: number
  messages: Array<{ id: string; subject: string; sender: string; date: string; preview: string; is_read: boolean }>
}
