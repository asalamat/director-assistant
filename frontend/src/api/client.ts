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
    account_id?: number
  }): Promise<{ emails: EmailSummary[]; total: number; has_more: boolean }> {
    const qs = new URLSearchParams()
    if (params.skip !== undefined) qs.set('skip', String(params.skip))
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    if (params.folder) qs.set('folder', params.folder)
    if (params.q) qs.set('q', params.q)
    if (params.sort_by) qs.set('sort_by', params.sort_by)
    if (params.sort_order) qs.set('sort_order', params.sort_order)
    if (params.from_date) qs.set('from_date', params.from_date)
    if (params.account_id !== undefined) qs.set('account_id', String(params.account_id))
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

  // Snooze
  snoozeEmail(emailId: string, wakeDate: string): Promise<void> {
    return request(`/snooze/${encodeURIComponent(emailId)}`, { method: 'POST', body: JSON.stringify({ wake_date: wakeDate }) })
  },
  unsnoozeEmail(emailId: string): Promise<void> {
    return request(`/snooze/${encodeURIComponent(emailId)}`, { method: 'DELETE' })
  },

  // Analytics
  getAnalytics(days = 30): Promise<AnalyticsResponse> {
    return request(`/analytics?days=${days}`)
  },

  // Sender stats
  getSenderStats(sender: string): Promise<SenderStats> {
    return request(`/sender/${encodeURIComponent(sender)}`)
  },

  // Ask DB
  askDB(question: string, n_results = 15): Promise<{
    answer: string
    sources: { email_id: string; subject: string; sender: string; date: string }[]
  }> {
    return request('/ask', { method: 'POST', body: JSON.stringify({ question, n_results }) })
  },

  // Manual poll trigger
  pollNow(): Promise<{ status: string }> {
    return request('/poll/now', { method: 'POST' })
  },

  // Quit the application
  shutdown(): Promise<{ status: string }> {
    return request('/shutdown', { method: 'POST' })
  },

  // Documents
  browseFolder(path?: string): Promise<{ current: string; parent: string | null; dirs: { name: string; path: string }[] }> {
    const qs = path ? `?path=${encodeURIComponent(path)}` : ''
    return request(`/documents/browse${qs}`)
  },
  getDocumentFolders(): Promise<{ folders: string[] }> {
    return request('/documents/folders')
  },
  setDocumentFolders(folders: string[]): Promise<{ status: string; folders: string[] }> {
    return request('/documents/folders', { method: 'POST', body: JSON.stringify({ folders }) })
  },
  ingestDocuments(): Promise<{ status: string; folders: string[] }> {
    return request('/documents/ingest', { method: 'POST' })
  },
  getDocumentIngestStatus(): Promise<{ status: string; processed: number; total: number; message: string }> {
    return request('/documents/status')
  },
  listDocuments(): Promise<{ documents: { doc_id: string; filename: string; file_type: string; file_path: string; modified_at: string; chunk_total: number }[]; total: number }> {
    return request('/documents')
  },
  reindexEmails(): Promise<{ status: string }> {
    return request('/documents/reindex-emails', { method: 'POST' })
  },
  getReindexEmailsStatus(): Promise<{ status: string; indexed: number; error?: string }> {
    return request('/documents/reindex-emails/status')
  },

  // Saved searches
  getSavedSearches(): Promise<{ id: number; name: string; query: string; folder: string }[]> {
    return request('/saved-searches')
  },
  createSavedSearch(name: string, query: string, folder: string): Promise<{ id: number }> {
    return request('/saved-searches', { method: 'POST', body: JSON.stringify({ name, query, folder }) })
  },
  deleteSavedSearch(id: number): Promise<void> {
    return request(`/saved-searches/${id}`, { method: 'DELETE' })
  },

  // Save draft to IMAP
  saveDraft(data: { to: string; subject: string; body: string; account_id?: number }): Promise<{ status: string }> {
    return request('/drafts/save', { method: 'POST', body: JSON.stringify(data) })
  },

  // Send email via SMTP
  sendEmail(data: { to: string; subject: string; body: string; account_id?: number }): Promise<{ status: string }> {
    return request('/email/send', { method: 'POST', body: JSON.stringify(data) })
  },

  // Dock badge
  setDockBadge(count: number): Promise<void> {
    return request(`/badge/${count}`, { method: 'POST' })
  },

  // App config
  getConfig(): Promise<AppConfig> {
    return request('/config')
  },
  saveConfig(data: { anthropic_api_key?: string; openai_api_key?: string; poll_interval_seconds?: number; budget_mode?: boolean; sync_window_days?: number }): Promise<{ status: string; has_api_key: boolean; has_openai_key: boolean }> {
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
  ingestAccount(id: number, fromDate?: string): Promise<void> {
    return request(`/accounts/${id}/ingest`, { method: 'POST', body: JSON.stringify({ from_date: fromDate || null }) })
  },
  ingestAll(fromDate?: string): Promise<void> {
    return request('/accounts/ingest-all', { method: 'POST', body: JSON.stringify({ from_date: fromDate || null }) })
  },
  // Microsoft OAuth2 device flow
  startMicrosoftOAuth(client_id: string, username: string): Promise<{
    flow_id: string; user_code: string; verification_uri: string; expires_in: number
  }> {
    return request('/oauth/microsoft/start', { method: 'POST', body: JSON.stringify({ client_id, username }) })
  },
  pollMicrosoftOAuth(flow_id: string): Promise<{
    status: 'pending' | 'completed'; access_token?: string; username?: string
  }> {
    return request(`/oauth/microsoft/poll?flow_id=${encodeURIComponent(flow_id)}`)
  },

  clearAndReingest(fromDate?: string): Promise<{ cleared: number; status: string; accounts: number }> {
    return request('/accounts/clear-and-reingest', {
      method: 'POST',
      body: fromDate ? JSON.stringify({ from_date: fromDate }) : undefined,
    })
  },

  subscribeAccountsIngestProgress(onProgress: (p: IngestProgress) => void): EventSource {
    const es = new EventSource('/api/accounts/ingest/progress')
    es.onmessage = (e) => {
      try { onProgress(JSON.parse(e.data)) } catch { /* ignore */ }
    }
    return es
  },

  // Intelligence / Knowledge Base
  getPeople(limit = 60): Promise<{ people: import('../types').Person[] }> {
    return request(`/intelligence/people?limit=${limit}`)
  },
  getClusters(): Promise<{ clusters: import('../types').Cluster[] }> {
    return request('/intelligence/clusters')
  },
  getTimeline(q: string, limit = 60): Promise<{ events: import('../types').TimelineEvent[] }> {
    return request(`/intelligence/timeline?q=${encodeURIComponent(q)}&limit=${limit}`)
  },
  getOpenLoops(): Promise<{ loops: import('../types').OpenLoop[] }> {
    return request('/intelligence/loops', { method: 'POST' })
  },
  streamBriefing(onEvent: (section: string, content: unknown) => void): () => void {
    const es = new EventSource('/api/intelligence/briefing')
    // EventSource only does GET; use fetch for POST SSE
    es.close()
    const ctrl = new AbortController()
    fetch('/api/intelligence/briefing', { method: 'POST', signal: ctrl.signal })
      .then(async (res) => {
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const evt = JSON.parse(line.slice(6))
                onEvent(evt.section, evt.content)
              } catch { /* ignore */ }
            }
          }
        }
      })
      .catch(() => {})
    return () => ctrl.abort()
  },
  invalidateIntelligence(): Promise<{ status: string }> {
    return request('/intelligence/invalidate', { method: 'POST' })
  },

  checkUpdate(): Promise<{ current: string; latest: string | null; update_available: boolean; error?: string }> {
    return request('/update/check')
  },

  applyUpdate(): Promise<{ status: string; message: string }> {
    return request('/update/apply', { method: 'POST' })
  },
}
