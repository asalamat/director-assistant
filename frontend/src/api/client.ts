import type {
  EmailSummary,
  EmailMessage,
  AIRecommendation,
  IngestProgress,
  ConnectionStatus,
  ActionItem,
  FollowUp,
  Template,
  DigestResponse,
  SenderStats,
  AnalyticsResponse,
  Account,
  AppConfig,
} from '../types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export const api = {
  // Connection
  connect(data: object) {
    return request('/connection/connect', { method: 'POST', body: JSON.stringify(data) })
  },
  getStatus(): Promise<ConnectionStatus> {
    return request('/connection/status')
  },
  disconnect() {
    return request('/connection/disconnect', { method: 'DELETE' })
  },
  startIngest() {
    return request('/connection/ingest', { method: 'POST' })
  },
  getIngestStatus(): Promise<IngestProgress> {
    return request('/connection/ingest/status')
  },

  // Emails
  listEmails(params: {
    skip?: number
    limit?: number
    folder?: string
    q?: string
    sort_by?: 'date' | 'sender' | 'subject'
    sort_order?: 'asc' | 'desc'
    from_date?: string
  }): Promise<{ emails: EmailSummary[]; total: number; has_more: boolean }> {
    const qs = new URLSearchParams()
    if (params.skip !== undefined) qs.set('skip', String(params.skip))
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    if (params.folder) qs.set('folder', params.folder)
    if (params.q) qs.set('q', params.q)
    if (params.sort_by) qs.set('sort_by', params.sort_by)
    if (params.sort_order) qs.set('sort_order', params.sort_order)
    if (params.from_date) qs.set('from_date', params.from_date)
    return request(`/emails/?${qs}`)
  },

  startIngestWithOptions(opts: { from_date?: string; folders?: string[] }) {
    return request('/connection/ingest', { method: 'POST', body: JSON.stringify(opts) })
  },

  getEmail(id: string, folder = 'INBOX'): Promise<EmailMessage> {
    return request(`/emails/${id}?folder=${folder}`)
  },

  deleteEmail(id: string): Promise<{ deleted: string }> {
    return request(`/emails/${id}`, { method: 'DELETE' })
  },

  importBySubject(subject: string): Promise<{ imported: { id: string; subject: string; sender: string; folder: string }[]; count: number; errors: string[] }> {
    return request('/emails/import-by-subject', { method: 'POST', body: JSON.stringify({ subject }) })
  },

  getRecommendation(id: string, folder = 'INBOX'): Promise<AIRecommendation> {
    return request(`/emails/${id}/recommend?folder=${folder}`)
  },

  search(query: string, n = 10) {
    return request('/emails/search', {
      method: 'POST',
      body: JSON.stringify({ query, n_results: n }),
    })
  },

  getStats(): Promise<{
    rag: { total_chunks: number; unique_emails_indexed: number; cached_emails: number; db_size_mb: number }
    ingest: { status: string; processed: number; total: number; message: string }
    poll: { interval_seconds: number; last_checked: string; last_new: number }
    accounts: { id: number; username: string; provider: string; last_ingested: string | null }[]
  }> {
    return fetch('/api/stats').then(r => r.json())
  },

  // SSE stream for ingest progress
  subscribeIngestProgress(onProgress: (p: IngestProgress) => void): EventSource {
    const es = new EventSource('/api/connection/ingest/progress')
    es.onmessage = (e) => {
      try {
        onProgress(JSON.parse(e.data))
      } catch {
        // ignore
      }
    }
    return es
  },

  // Classify
  classifyEmail(id: string): Promise<{ email_id: string; category: string }> {
    return request(`/emails/${id}/classify`, { method: 'POST' })
  },
  getEmailCategory(id: string): Promise<{ email_id: string; category: string | null }> {
    return request(`/emails/${id}/category`)
  },

  // Digest
  getDigest(hours = 24): Promise<DigestResponse> {
    return request(`/digest?hours=${hours}`)
  },

  // Action Items
  getActions(done?: boolean): Promise<ActionItem[]> {
    const qs = done !== undefined ? `?done=${done}` : ''
    return request(`/actions${qs}`)
  },
  setActionDone(id: number, done: boolean): Promise<void> {
    return request(`/actions/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) })
  },

  // Follow-ups
  getFollowUps(done?: boolean): Promise<FollowUp[]> {
    const qs = done !== undefined ? `?done=${done}` : ''
    return request(`/followups${qs}`)
  },
  createFollowUp(f: Omit<FollowUp, 'id' | 'created_at' | 'done'>): Promise<{ id: number }> {
    return request('/followups', { method: 'POST', body: JSON.stringify({ ...f, done: false }) })
  },
  setFollowUpDone(id: number, done: boolean): Promise<void> {
    return request(`/followups/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) })
  },
  deleteFollowUp(id: number): Promise<void> {
    return request(`/followups/${id}`, { method: 'DELETE' })
  },

  // Templates
  getTemplates(): Promise<Template[]> {
    return request('/templates')
  },
  createTemplate(t: Omit<Template, 'id'>): Promise<{ id: number }> {
    return request('/templates', { method: 'POST', body: JSON.stringify(t) })
  },
  updateTemplate(id: number, t: Template): Promise<void> {
    return request(`/templates/${id}`, { method: 'PUT', body: JSON.stringify(t) })
  },
  deleteTemplate(id: number): Promise<void> {
    return request(`/templates/${id}`, { method: 'DELETE' })
  },

  // Analytics
  getAnalytics(days = 30): Promise<AnalyticsResponse> {
    return request(`/analytics?days=${days}`)
  },

  // Sender stats
  getSenderStats(sender: string): Promise<SenderStats> {
    return request(`/sender/${encodeURIComponent(sender)}`)
  },

  // Manual poll trigger
  pollNow(): Promise<{ status: string }> {
    return request('/poll/now', { method: 'POST' })
  },

  // App config
  getConfig(): Promise<AppConfig> {
    return request('/config')
  },
  saveConfig(data: { anthropic_api_key?: string; openai_api_key?: string; poll_interval_seconds?: number; budget_mode?: boolean }): Promise<{ status: string; has_api_key: boolean; has_openai_key: boolean }> {
    return request('/config', { method: 'POST', body: JSON.stringify(data) })
  },
  testApiKey(key: string): Promise<{ valid: boolean; model?: string; error?: string }> {
    return request('/config/test-key', { method: 'POST', body: JSON.stringify({ anthropic_api_key: key }) })
  },
  testOpenAIKey(key: string): Promise<{ valid: boolean; model?: string; error?: string }> {
    return request('/config/test-openai-key', { method: 'POST', body: JSON.stringify({ openai_api_key: key }) })
  },

  // Accounts
  getAccounts(): Promise<Account[]> {
    return request('/accounts')
  },
  addAccount(data: object): Promise<{ id: number; status: string }> {
    return request('/accounts', { method: 'POST', body: JSON.stringify(data) })
  },
  removeAccount(id: number): Promise<void> {
    return request(`/accounts/${id}`, { method: 'DELETE' })
  },
  ingestAccount(id: number): Promise<void> {
    return request(`/accounts/${id}/ingest`, { method: 'POST' })
  },
  ingestAll(): Promise<void> {
    return request('/accounts/ingest-all', { method: 'POST' })
  },
  subscribeAccountsIngestProgress(onProgress: (p: IngestProgress) => void): EventSource {
    const es = new EventSource('/api/accounts/ingest/progress')
    es.onmessage = (e) => {
      try { onProgress(JSON.parse(e.data)) } catch { /* ignore */ }
    }
    return es
  },
}
