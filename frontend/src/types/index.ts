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

export interface SnoozeEntry {
  email_id: string
  wake_date?: string | null
  created_at?: string | null
  subject?: string | null
  sender?: string | null
  date?: string | null
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

export interface SprintEmail {
  id: string
  sender: string
  subject: string
  date: string
}

export interface QuickReplies {
  short: string
  detailed: string
  formal: string
}

export interface StyleProfile {
  formality?: string
  avg_sentence_length?: string
  greeting_style?: string
  closing_style?: string
  signature_name?: string | null
  punctuation?: string
  emoji_usage?: string
  vocabulary?: string
  tone?: string
  summary?: string
}

export interface Commitment {
  id: number
  email_id: string
  email_subject: string
  thread_id: string
  direction: 'i_owe' | 'they_owe'
  description: string
  counterparty: string
  due_date: string | null
  status: 'open' | 'fulfilled' | 'expired'
  created_at: string
  fulfilled_at: string | null
}

export type RewriteToneName =
  | 'warmer'
  | 'more_direct'
  | 'more_formal'
  | 'shorter'
  | 'more_enthusiastic'
  | 'more_concise'

export interface ToneReport {
  tone: string
  score: number
  issues: string[]
  label: 'good' | 'warning' | 'issue'
  suggestions: string[]
}

export interface RewriteOption {
  tone: string
  text: string
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
  weather_location?: string
  weather_lat?: number | null
  weather_lon?: number | null
  weather_unit?: string
  news_enabled?: boolean
  news_topics?: string[]
  email_persona?: string
  morning_brief_email_enabled?: boolean
  morning_brief_email_to?: string
  morning_brief_email_time?: string
  user_name?: string
}

export interface NewsArticle {
  title: string
  url: string
  source: string
  published: string
  body: string
  topic: string
  relevance: number
  summary: string
}

export interface NewsResponse {
  enabled: boolean
  articles: NewsArticle[]
  fetched_at: number | null
  hint?: string
}

export interface WeatherResult {
  name: string
  label: string
  latitude: number
  longitude: number
  country: string
  admin1: string
}

export interface WeatherData {
  configured: boolean
  location?: string
  unit: string
  temp_c?: number
  feels_c?: number
  humidity?: number
  wind_kmh?: number
  weather?: { code: number; label: string; emoji: string }
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
  status: 'active' | 'dormant' | 'resolved' | 'disabled'
  email_ids?: string[]
}

export interface OpenLoop {
  type: 'commitment' | 'awaiting' | 'deadline'
  text: string
  sender: string
  date: string
  urgency: 'high' | 'medium' | 'low'
}

export interface RelationshipNudge {
  name: string
  email: string
  is_vip: boolean
  last_contact_date: string | null
  last_subject: string | null
  days_since: number
  suggested_context: string
}

export interface Decision {
  id: string
  subject: string
  sender: string
  date: string
  direction: 'mine' | 'theirs'
  days_waiting: number
  snippet: string
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

export interface SocialMessage {
  id: string
  platform: 'instagram' | 'linkedin'
  type: 'dm' | 'comment' | 'mention'
  sender_name: string
  sender_id: string
  content: string
  media_url: string
  parent_id: string
  is_read: number
  replied_at: string | null
  created_at: string
}

export interface PostScore {
  score: number
  factors: {
    length: number
    hashtags: number
    cta: boolean
    timing: boolean
    hook: boolean
  }
  suggestions: string[]
}

export interface LinkedInVoiceProfile {
  avg_length: string
  hook_style: string
  emoji_usage: string
  cta_style: string
  formality: string
  recurring_themes: string[]
}

export interface CRMDeal {
  id: number
  name: string
  contact_email: string
  stage: string
  value: string
  notes: string
  last_email_at: string | null
}

export interface CRMDealEmail {
  email_id: string
  subject: string
  sender: string
  date: string
  direction: string
}

export interface EmailThread {
  thread_id: string
  subject: string
  participants: string[]
  latest_date: string
  message_count: number
  messages: Array<{ id: string; subject: string; sender: string; date: string; preview: string; is_read: boolean }>
}

export interface BriefSection {
  id: string
  title: string
  icon: string
  items: { text: string; meta: string }[]
  insight: string
}

export interface MorningBrief {
  generated_at: string
  greeting: string
  sections: BriefSection[]
  focus: string
  cached: boolean
}

export interface CalEvent {
  id: string
  title: string
  start: string
  end: string
  date: string
  location: string
  organizer: string
  is_online: boolean
  join_url: string
  attendee_count: number
  response: string
}

export interface CalendarResponse {
  events: CalEvent[]
  provider: 'google' | 'microsoft' | 'none'
  days: number
}

export interface ActiveDeal {
  name: string
  stage: string
}

export interface ContactHealth {
  id: number
  name: string
  email: string
  note: string
  score: number
  status: 'healthy' | 'good' | 'fading' | 'at_risk' | 'cold'
  trend: 'warming' | 'cooling' | 'stable'
  days_since_contact: number | null
  last_received: string | null
  last_sent_to: string | null
  received_count: number
  sent_count: number
  unread_count: number
  awaiting_reply: boolean
  open_commitments: number
  active_deal: ActiveDeal | null
}

export interface ContactHealthResponse {
  contacts: ContactHealth[]
  summary: { total: number; healthy: number; good: number; fading: number; at_risk: number; cold: number }
}

export interface DbStats {
  db_size_mb: number
  email_count: number
  vip_count: number
  total_tables: number
  last_vacuum: string | null
  retention_days: number
}

export interface AutopilotRule {
  id: number
  email_addr: string
  display_name: string
  mode: 'reply' | 'draft' | 'off'
  prompt_hint: string
  created_at: string
}
