export type EmailCategory =
  | 'proposal' | 'contract' | 'invoice' | 'meeting'
  | 'action_required' | 'fyi' | 'newsletter' | 'other'

export const CATEGORY_LABELS: Record<EmailCategory, { text: string; cls: string }> = {
  proposal:        { text: 'Proposal',    cls: 'bg-blue-100 text-blue-700' },
  contract:        { text: 'Contract',    cls: 'bg-indigo-100 text-indigo-700' },
  invoice:         { text: 'Invoice',     cls: 'bg-yellow-100 text-yellow-700' },
  meeting:         { text: 'Meeting',     cls: 'bg-teal-100 text-teal-700' },
  action_required: { text: 'Action',      cls: 'bg-orange-100 text-orange-700' },
  fyi:             { text: 'FYI',         cls: 'bg-gray-100 text-gray-600' },
  newsletter:      { text: 'Newsletter',  cls: 'bg-slate-100 text-slate-500' },
  other:           { text: 'Other',       cls: 'bg-gray-50 text-gray-400' },
}

export interface EmailSummary {
  id: string
  subject: string
  sender: string
  date: string | null
  preview: string
  is_read: boolean
  category?: EmailCategory | null
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

export interface WaitingEmail {
  id: string
  subject: string
  sender: string
  recipient: string
  date: string
  days_waiting: number
}

export interface ForgotReplyEmail {
  id: string
  subject: string
  sender: string
  date: string
  days_ago: number
}

export interface QuickReplies {
  short: string
  detailed: string
  formal: string
}

export interface AppConfig {
  has_api_key: boolean
  api_key_preview: string
  has_openai_key: boolean
  openai_key_preview: string
  ms_client_id: string
  has_ms_client_id: boolean
  google_client_id: string
  has_google_client_id: boolean
  poll_interval_seconds: number
  budget_mode: boolean
  sync_window_days: number
  digest_schedule_enabled: boolean
  digest_schedule_time: string
  digest_schedule_email: string
  translation_language: string
  webhook_urls?: string[]
  webhook_events?: string[]
  has_elevenlabs?: boolean
  elevenlabs_voice_id?: string
}

export interface TriageEmail {
  id: string
  subject: string
  sender: string
  date: string
  preview: string
  score: number
  reasons: string[]
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

export interface AIProvider {
  type: string
  label: string
  enabled: boolean
  priority: number
  key_preview: string
  base_url: string
  model_override: string
}

export interface AIProviderSave {
  type: string
  label?: string
  key: string
  enabled: boolean
  priority: number
  base_url?: string
  model_override?: string
}

export interface EmailThread {
  thread_id: string
  subject: string
  participants: string[]
  latest_date: string
  message_count: number
  messages: Array<{ id: string; subject: string; sender: string; date: string; preview: string; is_read: boolean }>
}
