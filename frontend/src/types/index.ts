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

export type EmailProvider = 'yahoo_imap' | 'generic_imap' | 'office365'
