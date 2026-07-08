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
  WeatherResult,
  WeatherData,
  NewsResponse,
  AskHistoryEntry,
  EmailThread,
  AIProvider,
  AIProviderSave,
  ForgotReplyEmail,
  SprintEmail,
  ToneReport,
  RewriteOption,
  SnoozeEntry,
  SocialMessage,
  PostScore,
  LinkedInVoiceProfile,
  CRMDeal,
  CRMDealEmail,
  DbStats,
  AutopilotRule,
} from '../types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || err.message || 'Request failed')
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
    to_date?: string
    account_id?: number
    only_unread?: boolean
    category?: string
    sender_filter?: string
    has_attachment?: boolean
  }): Promise<{ emails: EmailSummary[]; total: number; has_more: boolean }> {
    const qs = new URLSearchParams()
    if (params.skip !== undefined) qs.set('skip', String(params.skip))
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    if (params.folder) qs.set('folder', params.folder)
    if (params.q) qs.set('q', params.q)
    if (params.sort_by) qs.set('sort_by', params.sort_by)
    if (params.sort_order) qs.set('sort_order', params.sort_order)
    if (params.from_date) qs.set('from_date', params.from_date)
    if (params.to_date) qs.set('to_date', params.to_date)
    if (params.account_id !== undefined) qs.set('account_id', String(params.account_id))
    if (params.only_unread) qs.set('only_unread', 'true')
    if (params.category) qs.set('category', params.category)
    if (params.sender_filter) qs.set('sender_filter', params.sender_filter)
    if (params.has_attachment) qs.set('has_attachment', 'true')
    return request(`/emails/?${qs}`)
  },

  startIngestWithOptions(opts: { from_date?: string; folders?: string[] }) {
    return request('/connection/ingest', { method: 'POST', body: JSON.stringify(opts) })
  },

  getEmail(id: string, folder = 'INBOX'): Promise<EmailMessage> {
    return request(`/emails/${encodeURIComponent(id)}?folder=${folder}`)
  },

  getEmailThread(emailId: string): Promise<{
    thread: { id: string; subject: string; sender: string; date: string; body: string; is_read: boolean }[]
    thread_id: string | null
    total: number
  }> {
    return request(`/emails/${encodeURIComponent(emailId)}/thread`)
  },

  listAttachments(emailId: string): Promise<{ attachments: { filename: string; content_type: string; index: number }[]; email_id: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/attachments`)
  },

  deleteEmail(id: string): Promise<{ deleted: string }> {
    return request(`/emails/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  bulkEmailAction(
    action: 'archive' | 'delete' | 'mark_read',
    emailIds: string[],
  ): Promise<{ action: string; processed: number; ids: string[] }> {
    return request('/emails/bulk-action', {
      method: 'POST',
      body: JSON.stringify({ action, email_ids: emailIds }),
    })
  },

  importBySubject(subject: string): Promise<{ imported: { id: string; subject: string; sender: string; folder: string }[]; count: number; errors: string[] }> {
    return request('/emails/import-by-subject', { method: 'POST', body: JSON.stringify({ subject }) })
  },

  getRecommendation(id: string, folder = 'INBOX'): Promise<AIRecommendation> {
    return request(`/emails/${encodeURIComponent(id)}/recommend?folder=${folder}`)
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
    return request(`/emails/${encodeURIComponent(id)}/classify`, { method: 'POST' })
  },
  getEmailCategory(id: string): Promise<{ email_id: string; category: string | null }> {
    return request(`/emails/${encodeURIComponent(id)}/category`)
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
  updateFollowUpDueDate(id: number, dueDate: string): Promise<void> {
    return request(`/followups/${id}`, { method: 'PATCH', body: JSON.stringify({ due_date: dueDate }) })
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
  snoozeEmail(emailId: string, wakeDate?: string, setAside?: boolean): Promise<{ ok: boolean }> {
    return request(`/snooze/${encodeURIComponent(emailId)}`, {
      method: 'POST',
      body: JSON.stringify({ wake_date: wakeDate ?? null, set_aside: setAside ?? false }),
    })
  },
  listSnoozed(): Promise<{ snoozed: SnoozeEntry[] }> {
    return request('/snooze')
  },
  listSetAside(): Promise<{ emails: SnoozeEntry[] }> {
    return request('/snooze/set-aside')
  },
  wakeSnoozesDue(): Promise<{ woken: string[] }> {
    return request('/snooze/wake-due', { method: 'POST' })
  },
  sprintTriage(limit?: number): Promise<{
    buckets: {
      reply_now: SprintEmail[]
      needs_thought: SprintEmail[]
      fyi_archive: SprintEmail[]
      delegate: SprintEmail[]
    }
    total: number
  }> {
    return request('/triage/sprint', { method: 'POST', body: JSON.stringify({ limit: limit ?? 60 }) })
  },
  unsnoozeEmail(emailId: string): Promise<{ ok: boolean }> {
    return request(`/snooze/${encodeURIComponent(emailId)}`, { method: 'DELETE' })
  },

  // Analytics
  getAnalytics(days = 30): Promise<AnalyticsResponse> {
    return request(`/analytics?days=${days}`)
  },

  getMoodTimeline(days = 30): Promise<{ date: string; score: number; count: number; dominant_category: string }[]> {
    return request(`/analytics/mood-timeline?days=${days}`)
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

  // Manual poll trigger — waits for the poll to complete before resolving
  pollNow(): Promise<{ status: string; new_count: number }> {
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
  sendEmail(data: { to: string; subject: string; body: string; account_id?: number; cc?: string; bcc?: string; is_html?: boolean }): Promise<{ status: string }> {
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
  updateConfig(data: { translation_language?: string; [key: string]: unknown }): Promise<unknown> {
    return request('/config', { method: 'POST', body: JSON.stringify(data) })
  },
  // DB maintenance
  getDbStats(): Promise<DbStats> {
    return request('/db/stats')
  },
  optimizeDb(): Promise<{ status: string; duration_ms: number; last_vacuum: string; db_size_mb: number }> {
    return request('/db/optimize', { method: 'POST' })
  },
  applyRetention(): Promise<{ status: string; deleted: number; cutoff?: string }> {
    return request('/db/retention', { method: 'DELETE' })
  },
  saveConfig(data: { anthropic_api_key?: string; openai_api_key?: string; ms_client_id?: string; google_client_id?: string; google_client_secret?: string; poll_interval_seconds?: number; budget_mode?: boolean; sync_window_days?: number; digest_schedule_enabled?: boolean; digest_schedule_time?: string; digest_schedule_email?: string; translation_language?: string }): Promise<{ status: string; has_api_key: boolean; has_openai_key: boolean }> {
    return request('/config', { method: 'POST', body: JSON.stringify(data) })
  },
  testApiKey(key: string): Promise<{ valid: boolean; model?: string; error?: string }> {
    return request('/config/test-key', { method: 'POST', body: JSON.stringify({ anthropic_api_key: key }) })
  },
  searchWeatherLocation(q: string): Promise<{ results: WeatherResult[] }> {
    return request(`/weather/search?q=${encodeURIComponent(q)}`)
  },
  getWeather(): Promise<WeatherData> {
    return request('/weather')
  },
  getNews(force?: boolean): Promise<NewsResponse> {
    return request(`/news${force ? '?force=true' : ''}`)
  },
  refreshNews(): Promise<NewsResponse> {
    return request('/news/refresh', { method: 'POST' })
  },
  getMorningBrief(force?: boolean): Promise<import('../types').MorningBrief> {
    return request(`/morning-brief${force ? '?force=true' : ''}`)
  },
  getCalendar(days = 7, force?: boolean): Promise<import('../types').CalendarResponse> {
    const qs = new URLSearchParams({ days: String(days) })
    if (force) qs.set('force', 'true')
    return request(`/calendar?${qs}`)
  },
  summarizeNews(articles: { url: string; title: string; body: string }[]): Promise<{ summaries: { url: string; what: string; why: string; takeaway: string }[] }> {
    return request('/news/summarize', { method: 'POST', body: JSON.stringify({ articles }) })
  },
  testOpenAIKey(key: string): Promise<{ valid: boolean; model?: string; error?: string }> {
    return request('/config/test-openai-key', { method: 'POST', body: JSON.stringify({ openai_api_key: key }) })
  },

  // AI Provider management
  getProviders(): Promise<{ providers: AIProvider[]; available_types: Record<string, {label: string; base_url: string}>; available_models: Record<string, string[]> }> {
    return request('/config/providers')
  },
  saveProviders(providers: AIProviderSave[]): Promise<{ saved: number; primary: string }> {
    return request('/config/providers', { method: 'POST', body: JSON.stringify({ providers }) })
  },
  testProvider(p: { type: string; key: string; base_url?: string; model?: string }): Promise<{ valid: boolean; model?: string; provider?: string; error?: string }> {
    return request('/config/providers/test', { method: 'POST', body: JSON.stringify(p) })
  },
  getProviderStatuses(): Promise<{ statuses: { index: number; type: string; label: string; status: string; detail: string; balance: string | null; billing_url: string }[] }> {
    return request('/config/providers/status')
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
  consolidateAccounts(): Promise<{ merged_groups: number; accounts_removed: number; message: string }> {
    return request('/accounts/consolidate', { method: 'POST' })
  },
  ingestAccount(id: number, fromDate?: string): Promise<void> {
    return request(`/accounts/${id}/ingest`, { method: 'POST', body: JSON.stringify({ from_date: fromDate || null }) })
  },
  ingestAll(fromDate?: string): Promise<void> {
    return request('/accounts/ingest-all', { method: 'POST', body: JSON.stringify({ from_date: fromDate || null }) })
  },
  // Google OAuth2
  getGoogleAuthUrl(username?: string): Promise<{ url: string }> {
    const q = username ? `?username=${encodeURIComponent(username)}` : ''
    return request(`/oauth/google/auth-url${q}`)
  },

  // Microsoft OAuth2 device flow
  autoSetupMicrosoft(): Promise<{ status: string; message?: string; fix?: string; client_id?: string; device_code?: string; device_url?: string }> {
    return request('/oauth/microsoft/auto-setup', { method: 'POST' })
  },
  getMicrosoftAuthUrl(username?: string): Promise<{ url: string }> {
    const q = username ? `?username=${encodeURIComponent(username)}` : ''
    return request(`/oauth/microsoft/auth-url${q}`)
  },
  startMicrosoftOAuth(username: string): Promise<{
    flow_id: string; user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number
  }> {
    return request('/oauth/microsoft/start', { method: 'POST', body: JSON.stringify({ username }) })
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
  getClusters(showDisabled = false): Promise<{ clusters: import('../types').Cluster[] }> {
    return request(`/intelligence/clusters${showDisabled ? '?show_disabled=true' : ''}`)
  },
  generateClusters(): Promise<{ clusters: import('../types').Cluster[]; error?: string }> {
    return request('/intelligence/clusters/generate', { method: 'POST' })
  },
  updateClusterStatus(id: string, status: string): Promise<{ status: string; cluster_id: string }> {
    return request(`/intelligence/clusters/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
  },
  getTimeline(q: string, limit = 60, ids?: string[]): Promise<{ events: import('../types').TimelineEvent[] }> {
    if (ids && ids.length > 0)
      return request(`/intelligence/timeline?ids=${encodeURIComponent(ids.join(','))}&limit=${limit}`)
    return request(`/intelligence/timeline?q=${encodeURIComponent(q)}&limit=${limit}`)
  },
  getOpenLoops(): Promise<{ loops: import('../types').OpenLoop[] }> {
    return request('/intelligence/loops', { method: 'POST' })
  },
  getNudges(days = 21): Promise<{ nudges: import('../types').RelationshipNudge[]; total: number }> {
    return request(`/intelligence/relationship-nudges?days=${days}`)
  },
  dismissNudge(email: string, days = 30): Promise<{ dismissed: string; until: string }> {
    return request('/intelligence/nudges/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, days }),
    })
  },
  getChaseState(): Promise<{ dismissed: string[]; snoozed: Record<string, string>; notes: Record<string, string> }> {
    return request('/intelligence/chase/state')
  },
  chaseDismiss(emailId: string): Promise<{ status: string }> {
    return request('/intelligence/chase/dismiss', { method: 'POST', body: JSON.stringify({ email_id: emailId }) })
  },
  chaseRestore(emailId: string): Promise<{ status: string }> {
    return request(`/intelligence/chase/dismiss/${encodeURIComponent(emailId)}`, { method: 'DELETE' })
  },
  chaseClearAllDismissed(): Promise<{ status: string }> {
    return request('/intelligence/chase/dismiss', { method: 'DELETE' })
  },
  chaseSnooze(emailId: string, until: string): Promise<{ status: string }> {
    return request('/intelligence/chase/snooze', { method: 'POST', body: JSON.stringify({ email_id: emailId, until }) })
  },
  chaseUnsnooze(emailId: string): Promise<{ status: string }> {
    return request(`/intelligence/chase/snooze/${encodeURIComponent(emailId)}`, { method: 'DELETE' })
  },
  chaseSaveNote(emailId: string, note: string): Promise<{ status: string }> {
    return request('/intelligence/chase/note', { method: 'POST', body: JSON.stringify({ email_id: emailId, note }) })
  },
  getStakeholders(days = 90): Promise<{
    stakeholders: { name: string; email: string; received_count: number; sent_count: number; total_interactions: number; influence_score: number; last_contact: string | null; is_vip: boolean }[]
    total: number
    days: number
  }> {
    return request(`/intelligence/stakeholders?days=${days}`)
  },
  getDecisions(days = 30): Promise<{ decisions: import('../types').Decision[]; mine_count: number; theirs_count: number }> {
    return request(`/intelligence/decisions?days=${days}`)
  },
  getDecisionBrief(emailId: string): Promise<{ brief: string; subject: string; sender: string }> {
    return request('/intelligence/decisions/brief', { method: 'POST', body: JSON.stringify({ email_id: emailId }) })
  },
  getEscalations(days = 14): Promise<{
    escalations: {
      thread_key: string
      subject: string
      reply_count: number
      participant_count: number
      has_urgency: boolean
      last_reply: string
      hours_since_last: number
      escalation_score: number
      latest_email_id: string
      senders_preview: string[]
    }[]
    total: number
  }> {
    return request(`/intelligence/escalations?days=${days}`)
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
  getContactHints(): Promise<{
    hints: Record<string, { phones: string[]; sources: string[] }>
  }> {
    return request('/intelligence/contact-hints')
  },
  getContactHeatmap(email: string): Promise<{ heatmap: { date: string; count: number }[] }> {
    return request(`/intelligence/people/${encodeURIComponent(email)}/heatmap`)
  },
  getContactHealth(): Promise<import('../types').ContactHealthResponse> {
    return request('/contact-health')
  },
  getRagKnowledgeGraph(): Promise<{
    nodes: { id: string; label: string; type: 'person' | 'topic' | 'project'; count: number }[]
    edges: { source: string; target: string; weight: number }[]
    error?: string
  }> {
    return request('/intelligence/knowledge-graph')
  },
  transcribeMeeting(audio: Blob): Promise<{ transcript: string; action_items: string[]; draft_email: string }> {
    const form = new FormData()
    form.append('audio', audio, 'meeting.webm')
    return fetch(`${BASE}/meeting/transcribe`, { method: 'POST', body: form })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail || 'Transcription failed'))))
  },
  saveMeetingRecording(data: { transcript: string; action_items: string[]; draft_email: string; duration_secs: number; title?: string }): Promise<{ id: number; title: string }> {
    return request('/meeting/recordings', { method: 'POST', body: JSON.stringify(data) })
  },
  listMeetingRecordings(): Promise<{ recordings: { id: number; recorded_at: string; duration_secs: number; title: string; preview: string }[] }> {
    return request('/meeting/recordings')
  },
  getMeetingRecording(id: number): Promise<{ id: number; transcript: string; action_items: string[]; draft_email: string; title: string; recorded_at: string }> {
    return request(`/meeting/recordings/${id}`)
  },
  deleteMeetingRecording(id: number): Promise<void> {
    return request(`/meeting/recordings/${id}`, { method: 'DELETE' })
  },

  buildAgenda(data: { title: string; attendees: string[]; duration_mins: number; context_notes?: string }): Promise<{
    title: string; attendees: string[]; duration_mins: number;
    pre_meeting_prep: string[];
    agenda_items: { title: string; duration_mins: number; type: string; points: string[]; questions: string[] }[];
    success_criteria: string;
    follow_up_template: string;
  }> {
    return request('/meeting/build-agenda', { method: 'POST', body: JSON.stringify(data) })
  },

  analyzeMeetingNotes(notes: string, title?: string): Promise<{
    id?: number; title: string; summary: string;
    action_items: { task: string; owner: string; deadline: string; priority: string }[];
    decisions: string[];
    follow_up_emails: { to: string; subject: string; body: string }[];
    calendar_events: { title: string; date_hint: string; duration_mins: number; attendees: string[] }[];
  }> {
    return request('/meeting/analyze-notes', { method: 'POST', body: JSON.stringify({ notes, title }) })
  },

  importVCard(file: File): Promise<{ imported: number; skipped: number; total: number; message: string }> {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/contacts/import-vcard`, { method: 'POST', body: form })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail || 'Import failed'))))
  },
  importContacts(file: File): Promise<{ imported: number; skipped: number; total: number; message: string }> {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/contacts/import-contacts`, { method: 'POST', body: form })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail || 'Import failed'))))
  },
  exportVCard(): string {
    return `${BASE}/contacts/export-vcard`
  },
  syncContactsFromProvider(): Promise<{ success: boolean; imported: number; skipped: number; provider: string | null; message: string }> {
    return request('/contacts/sync-provider', { method: 'POST' })
  },
  findContactDuplicates(): Promise<{ duplicate_groups: any[]; total_groups: number }> {
    return request('/contacts/duplicates')
  },
  getContactGroups(): Promise<{ groups: Array<{ name: string; color: string; members: Array<{ name: string; email: string }> }> }> {
    return request('/contacts/groups')
  },
  autoGroupContacts(): Promise<{ groups: Array<{ name: string; color: string; members: Array<{ name: string; email: string }> }> }> {
    return request('/contacts/auto-group', { method: 'POST' })
  },
  mergeContactDuplicates(): Promise<{ merged_groups: number; records_removed: number; message: string }> {
    return request('/contacts/merge-duplicates', { method: 'POST' })
  },
  fuzzyMergeContacts(): Promise<{ merged_groups: number; records_removed: number; message: string }> {
    return request('/contacts/fuzzy-merge', { method: 'POST' })
  },
  updateContact(id: number, data: { name: string; phones: string[]; note: string }): Promise<{ updated: number }> {
    return request(`/contacts/imported/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  },
  upsertContact(data: { email_addr: string; name: string; phones: string[]; note: string }): Promise<{ id: number | null }> {
    return request('/contacts/upsert', { method: 'POST', body: JSON.stringify(data) })
  },
  hideContact(email: string): Promise<{ hidden: string }> {
    return request('/contacts/hide', { method: 'POST', body: JSON.stringify({ email_addr: email }) })
  },
  unhideContact(email: string): Promise<{ unhidden: string }> {
    return request(`/contacts/hide/${encodeURIComponent(email)}`, { method: 'DELETE' })
  },
  listHiddenContacts(): Promise<{ hidden: { email_addr: string; hidden_at: string }[] }> {
    return request('/contacts/hidden')
  },
  getContactTimeline(emailAddr: string, limit = 50): Promise<{ emails: Array<{ id: string; subject: string; date: string; direction: 'received' | 'sent'; snippet: string; folder: string }>; total: number }> {
    return request(`/contacts/timeline/${encodeURIComponent(emailAddr)}?limit=${limit}`)
  },

  // Triage
  getTriageTop(limit?: number): Promise<{ emails: import('../types').TriageEmail[] }> {
    return request(`/triage/top${limit ? `?limit=${limit}` : ''}`)
  },

  // Quick replies
  getQuickReplies(emailId: string): Promise<import('../types').QuickReplies> {
    return request(`/emails/${encodeURIComponent(emailId)}/quick-replies`, { method: 'POST' })
  },

  // Smart draft composer
  getSmartDraft(emailId: string): Promise<{ draft: string; subject: string; to: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/smart-draft`, { method: 'POST' })
  },

  // Voice-Matched Auto-Drafts
  learnWritingStyle(sampleCount = 50): Promise<{ style: import('../types').StyleProfile; samples_used: number }> {
    return request('/drafts/learn-style', { method: 'POST', body: JSON.stringify({ account_id: 0, sample_count: sampleCount }) })
  },
  getStyleProfile(): Promise<{ style: import('../types').StyleProfile | null; computed_at: string | null; sample_count: number }> {
    return request('/drafts/style-profile?account_id=0')
  },
  generateVoiceDraft(emailId: string, context?: string): Promise<{ draft: string; subject: string; to: string; style_applied: boolean }> {
    return request('/drafts/voice-draft', { method: 'POST', body: JSON.stringify({ email_id: emailId, context: context || null, account_id: 0 }) })
  },

  summarizeThread(emailId: string): Promise<{ summary: string; key_points: string[]; outcome: string; participants: string[]; message_count: number }> {
    return request(`/emails/${encodeURIComponent(emailId)}/summarize-thread`, { method: 'POST' })
  },

  extractCommitments(emailId: string, draft: string): Promise<{ commitments: string[] }> {
    return request(`/emails/${encodeURIComponent(emailId)}/extract-commitments`, {
      method: 'POST', body: JSON.stringify({ draft })
    })
  },

  addActionItem(emailId: string, emailSubject: string, items: string[]): Promise<{ saved: number }> {
    return request('/actions/bulk', { method: 'POST', body: JSON.stringify({ email_id: emailId, email_subject: emailSubject, items }) })
  },

  detectSentCommitments(): Promise<{ detected: { email_id: string; subject: string; date: string; commitments: string[] }[]; scanned: number }> {
    return request('/actions/detect-from-sent', { method: 'POST' })
  },

  // Commitment Tracker
  getCommitments(params?: { direction?: 'i_owe' | 'they_owe'; status?: 'open' | 'fulfilled' | 'expired' }): Promise<{ commitments: import('../types').Commitment[] }> {
    const qs = new URLSearchParams()
    if (params?.direction) qs.set('direction', params.direction)
    if (params?.status) qs.set('status', params.status)
    const q = qs.toString()
    return request(`/commitments${q ? '?' + q : ''}`)
  },
  scanCommitmentsBulk(days = 7): Promise<{ scanned: number; found: number }> {
    return request('/commitments/scan-bulk', { method: 'POST', body: JSON.stringify({ days }) })
  },
  fulfillCommitment(id: number, status: 'open' | 'fulfilled' | 'expired'): Promise<{ ok: boolean; status: string }> {
    return request(`/commitments/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
  },

  // Voice dictation — transcribe recorded audio
  transcribeAudio(blob: Blob, filename: string): Promise<{ transcript: string; cleaned: string; duration_hint?: string }> {
    const form = new FormData()
    form.append('audio', blob, filename)
    return fetch(`${BASE}/voice/transcribe`, { method: 'POST', body: form })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail || 'Transcription failed'))))
  },

  draftFromActionItem(itemId: number): Promise<{ to: string; subject: string; body: string }> {
    return request(`/actions/${itemId}/draft-reply`, { method: 'POST' })
  },

  detectInboxAsks(): Promise<{ detected: Array<{ email_id: string; subject: string; date: string; sender: string; asks: string[] }>; scanned: number }> {
    return request('/actions/detect-from-inbox', { method: 'POST' })
  },

  topicCluster(query: string, limit?: number): Promise<{ query: string; results: any[]; total: number }> {
    return request('/emails/topic-cluster', { method: 'POST', body: JSON.stringify({ query, limit: limit ?? 15 }) })
  },

  // Triage rules
  getTriageRules(): Promise<{ id: number; rule: string; created_at: string }[]> {
    return request('/triage-rules')
  },
  addTriageRule(rule: string): Promise<{ id: number; rule: string }> {
    return request('/triage-rules', { method: 'POST', body: JSON.stringify({ rule }) })
  },
  deleteTriageRule(id: number): Promise<{ ok: boolean }> {
    return request(`/triage-rules/${id}`, { method: 'DELETE' })
  },

  // Proactive alerts
  getProactiveAlerts(): Promise<{ alerts: { id: string; type: string; message: string; action: string | null; ts: string }[] }> {
    return request('/proactive-alerts')
  },

  // Contact relationship
  getContactRelationship(sender: string): Promise<{
    total_received: number; total_sent_to: number;
    last_received: string | null; last_sent_to: string | null;
    unreplied_count: number; avg_response_hours: number | null;
    recent_subjects: string[]; ai_summary: string | null;
  }> {
    return request(`/sender/${encodeURIComponent(sender)}/relationship`)
  },

  // Unsubscribe detection (read-only): method "url"|"mailto"|"none"
  getUnsubscribeUrl(emailId: string): Promise<{ method: 'url' | 'mailto' | 'none'; url: string | null }> {
    return request(`/emails/${encodeURIComponent(emailId)}/unsubscribe-url`)
  },

  // One-click unsubscribe: opens URL or sends a mailto unsubscribe server-side
  unsubscribe(emailId: string): Promise<{ method: 'url' | 'mailto' | 'none'; url?: string; sent?: boolean }> {
    return request(`/emails/${encodeURIComponent(emailId)}/unsubscribe`, { method: 'POST' })
  },

  // Calendar event creation
  createCalendarEvent(emailId: string, data: { title: string; start_datetime: string; end_datetime: string; attendees: string[]; description: string }): Promise<{ status: string; event_id: string; web_link: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/create-event`, { method: 'POST', body: JSON.stringify(data) })
  },

  getOneLineSummary(emailId: string): Promise<{ summary: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/one-line`)
  },

  getEmailPreview(emailId: string): Promise<{ preview: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/preview`)
  },

  // Waiting for reply
  getWaitingReplies(days?: number): Promise<{ emails: import('../types').WaitingEmail[]; threshold_days: number }> {
    return request(`/followups/waiting${days ? `?days=${days}` : ''}`)
  },

  // Forgot to reply — read emails with no reply sent
  getForgotReply(days?: number, limit?: number): Promise<{ emails: ForgotReplyEmail[]; total: number; days: number }> {
    const qs = new URLSearchParams()
    if (days) qs.set('days', String(days))
    if (limit) qs.set('limit', String(limit))
    const q = qs.toString()
    return request(`/emails/forgot-reply${q ? '?' + q : ''}`)
  },

  // Dismiss a forgot-reply email by adding it to follow_ups with done=true
  dismissForgotReply(emailId: string, subject: string, sender: string): Promise<{ id: number }> {
    return request('/followups', {
      method: 'POST',
      body: JSON.stringify({ email_id: emailId, subject, sender, due_date: '', done: true }),
    })
  },

  checkUpdate(): Promise<{ current: string; latest: string | null; update_available: boolean; error?: string }> {
    return request('/update/check')
  },

  applyUpdate(): Promise<{ status: string; message: string; log_path?: string; log_hint?: string }> {
    return request('/update/apply', { method: 'POST' })
  },

  getUpdateLog(): Promise<{ log: string | null; path: string; message?: string }> {
    return request('/update/log')
  },

  // Ask history
  getAskHistory(limit = 50, skip = 0): Promise<{ entries: AskHistoryEntry[]; total: number }> {
    return request(`/ask/history?limit=${limit}&skip=${skip}`)
  },

  // Compose new email (not a reply)
  sendNew(data: { to: string; cc?: string; bcc?: string; subject: string; body: string; account_id?: number }): Promise<{ status: string }> {
    return request('/email/send-new', { method: 'POST', body: JSON.stringify(data) })
  },

  // Email threads
  getThreads(params: { folder?: string; account_id?: number; skip?: number; limit?: number } = {}): Promise<{ threads: EmailThread[]; total: number }> {
    const qs = new URLSearchParams()
    if (params.folder) qs.set('folder', params.folder)
    if (params.account_id) qs.set('account_id', String(params.account_id))
    if (params.skip) qs.set('skip', String(params.skip))
    if (params.limit) qs.set('limit', String(params.limit))
    return request(`/emails/threads${qs.toString() ? '?' + qs.toString() : ''}`)
  },

  // Follow-up reminders (set remind_at on an email, '' to clear)
  setFollowupRemind(emailId: string, remindAt: string): Promise<{ email_id: string; followup_remind_at: string | null }> {
    return request(`/emails/${encodeURIComponent(emailId)}/followup-remind`, { method: 'POST', body: JSON.stringify({ remind_at: remindAt }) })
  },

  // Tone adjuster
  adjustTone(text: string, tone: 'formal' | 'casual' | 'shorter' | 'friendlier' | 'direct' | 'improve'): Promise<{ result: string }> {
    return request('/emails/adjust-tone', { method: 'POST', body: JSON.stringify({ text, tone }) })
  },

  // Tone Coach
  analyzeTone(text: string): Promise<ToneReport> {
    return request('/emails/analyze-tone', { method: 'POST', body: JSON.stringify({ text }) })
  },
  getRewriteOptions(text: string, tones: string[]): Promise<{ rewrites: RewriteOption[] }> {
    return request('/emails/rewrite-options', { method: 'POST', body: JSON.stringify({ text, tones }) })
  },

  // Email translation
  translateEmail(emailId: string, targetLang?: string): Promise<{ translation: string; detected_lang: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/translate`, {
      method: 'POST', body: JSON.stringify({ target_lang: targetLang ?? 'English' })
    })
  },

  analyzeAttachments(emailId: string): Promise<{
    attachments: {filename: string; type: string; summary: string}[]
    insights: {key: string; value: string; label: string}[]
    has_attachments: boolean
    detected_filenames: string[]
  }> {
    return request(`/emails/${encodeURIComponent(emailId)}/analyze-attachments`, { method: 'POST' })
  },

  extractFinancials(emailId: string): Promise<{
    type: string; vendor: string; amount: string; currency: string; date: string;
    due_date: string | null; description: string; reference: string;
    parties: string[]; key_terms: string[]; email_subject: string; email_sender: string
  }> {
    return request(`/emails/${encodeURIComponent(emailId)}/extract-financials`, { method: 'POST' })
  },

  getEmailCoaching(): Promise<{ tips: string[]; strengths: string[]; stats: { avg_length: number; reply_ratio: number; emails_analyzed: number } }> {
    return request('/intelligence/coaching')
  },

  // Priority sorted emails
  getPrioritySorted(folder?: string, limit?: number): Promise<{ emails: any[] }> {
    return request(`/triage/sorted?folder=${folder ?? 'INBOX'}&limit=${limit ?? 50}`)
  },

  // Bulk smart draft
  bulkSmartDraft(emailIds: string[]): Promise<{ drafts: { email_id: string; subject: string; to: string; draft: string }[] }> {
    return request('/emails/bulk-draft', { method: 'POST', body: JSON.stringify({ email_ids: emailIds }) })
  },

  // Sender monthly volume
  getSenderMonthlyVolume(sender: string): Promise<{ months: { month: string; count: number }[] }> {
    return request(`/sender/${encodeURIComponent(sender)}/monthly`)
  },

  // NL search
  nlSearch(query: string): Promise<{ query: string; filters: Record<string, string>; results: any[] }> {
    return request('/emails/nl-search', { method: 'POST', body: JSON.stringify({ query }) })
  },

  // Ask docs only
  askDocsOnly(question: string): Promise<{ answer: string; sources: { filename: string; file_type: string }[] }> {
    return request('/ask/docs', { method: 'POST', body: JSON.stringify({ question }) })
  },

  // Scheduled sends
  scheduleSend(data: { account_id?: number; to_addr: string; subject: string; body: string; send_at: string }): Promise<{ id: number; send_at: string }> {
    return request('/scheduled-sends', { method: 'POST', body: JSON.stringify(data) })
  },
  listScheduledSends(): Promise<{ id: number; account_id: number; to_addr: string; subject: string; body: string; send_at: string; sent: number; created_at: string }[]> {
    return request('/scheduled-sends')
  },
  cancelScheduledSend(id: number): Promise<{ ok: boolean }> {
    return request(`/scheduled-sends/${id}`, { method: 'DELETE' })
  },

  // Auto-label email
  autoLabelEmail(emailId: string): Promise<{ email_id: string; label: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/auto-label`, { method: 'POST' })
  },

  // Weekly Executive Brief
  getWeeklyBrief(): Promise<any> {
    return request('/weekly-brief', { method: 'POST' })
  },
  clearWeeklyBriefCache(): Promise<{ cleared: boolean }> {
    return request('/weekly-brief/cache', { method: 'DELETE' })
  },
  searchBriefItem(q: string): Promise<{ query: string; emails: any[] }> {
    return request(`/weekly-brief/search?q=${encodeURIComponent(q)}`)
  },
  sendBriefToInbox(): Promise<{ sent: boolean; to: string }> {
    return request('/weekly-brief/send-to-inbox', { method: 'POST' })
  },

  // VIP Contacts
  getVIPs(): Promise<{ vips: any[] }> {
    return request('/vip')
  },
  addVIP(data: { email_addr: string; name: string; note: string }): Promise<{ added: string }> {
    return request('/vip', { method: 'POST', body: JSON.stringify(data) })
  },
  updateVIP(id: number, data: { email_addr: string; name: string; note: string }): Promise<{ updated: number }> {
    return request(`/vip/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  },
  removeVIP(id: number): Promise<{ removed: number }> {
    return request(`/vip/${id}`, { method: 'DELETE' })
  },
  getVIPEmails(emailAddr: string, limit = 20): Promise<{ emails: any[] }> {
    return request(`/vip/emails/${encodeURIComponent(emailAddr)}?limit=${limit}`)
  },
  getVIPHealth(id: number): Promise<{
    vip_id: number; email_addr: string; name: string; trend: 'warming' | 'stable' | 'cooling'
    windows: { start: string; end: string; count: number }[]; total_90d: number
  }> {
    return request(`/vip/${id}/health`)
  },
  getDecayAlerts(): Promise<{
    alerts: { vip_id: number; name: string; email_addr: string; days_since_last: number; last_contact: string; recent_30d: number; prior_30d: number; severity: 'high'|'medium'; reasons: string[] }[]
    total: number
  }> {
    return request('/vip/decay-alerts')
  },

  // Chase Queue (follow-up drafts)
  generateChaseDraft(emailId: string): Promise<{ draft: string; subject: string; to: string; email_id: string }> {
    return request(`/followups/chase-draft/${encodeURIComponent(emailId)}`, { method: 'POST' })
  },
  draftFollowup(data: { email_id: string; subject: string; sender: string; original_body: string }): Promise<{ draft: string; to: string; subject: string }> {
    return request('/intelligence/draft-followup', { method: 'POST', body: JSON.stringify(data) })
  },

  // Projects
  getProjects(): Promise<{ projects: any[] }> {
    return request('/projects')
  },
  createProject(data: { name: string; description: string; status: string }): Promise<{ id: number; name: string }> {
    return request('/projects', { method: 'POST', body: JSON.stringify(data) })
  },
  updateProject(id: number, data: { name?: string; description?: string; status?: string }): Promise<{ ok: boolean }> {
    return request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  },
  deleteProject(id: number): Promise<{ deleted: number }> {
    return request(`/projects/${id}`, { method: 'DELETE' })
  },
  getProjectEmails(projectId: number): Promise<{ emails: any[] }> {
    return request(`/projects/${projectId}/emails`)
  },
  linkEmailToProject(projectId: number, emailId: string): Promise<{ linked: boolean }> {
    return request(`/projects/${projectId}/emails/${encodeURIComponent(emailId)}`, { method: 'POST' })
  },
  unlinkEmailFromProject(projectId: number, emailId: string): Promise<{ unlinked: boolean }> {
    return request(`/projects/${projectId}/emails/${encodeURIComponent(emailId)}`, { method: 'DELETE' })
  },
  getProjectsForEmail(emailId: string): Promise<{ projects: any[] }> {
    return request(`/projects/for-email/${encodeURIComponent(emailId)}`)
  },
  generateProjectPlan(id: number): Promise<{ plan: any }> {
    return request(`/projects/${id}/generate-plan`, { method: 'POST' })
  },
  getProjectPlan(id: number): Promise<{ plan: any }> {
    return request(`/projects/${id}/plan`)
  },
  getProjectDocuments(id: number): Promise<{ documents: { doc_id: string; filename: string; linked_at: string }[] }> {
    return request(`/projects/${id}/documents`)
  },
  linkProjectDocument(id: number, doc_id: string, filename: string): Promise<void> {
    return request(`/projects/${id}/documents`, { method: 'POST', body: JSON.stringify({ doc_id, filename }) })
  },
  unlinkProjectDocument(id: number, doc_id: string): Promise<void> {
    return request(`/projects/${id}/documents/${encodeURIComponent(doc_id)}`, { method: 'DELETE' })
  },
  getProjectNotes(id: number): Promise<{ notes: { id: number; note: string; created_at: string }[] }> {
    return request(`/projects/${id}/notes`)
  },
  addProjectNote(id: number, note: string): Promise<{ id: number; note: string }> {
    return request(`/projects/${id}/notes`, { method: 'POST', body: JSON.stringify({ note }) })
  },
  deleteProjectNote(projectId: number, noteId: number): Promise<void> {
    return request(`/projects/${projectId}/notes/${noteId}`, { method: 'DELETE' })
  },
  getProjectRecommendations(id: number): Promise<{ recommendations: any; note_count: number }> {
    return request(`/projects/${id}/recommendations`, { method: 'POST' })
  },
  getWeeklyUpdate(id: number): Promise<{ subject: string; body: string }> {
    return request(`/projects/${id}/weekly-update`, { method: 'POST' })
  },

  // Project Tasks
  getProjectTasks(id: number): Promise<{ tasks: any[] }> {
    return request(`/projects/${id}/tasks`)
  },
  createProjectTask(id: number, data: { name: string; status: string; assignee?: string; priority?: string; phase_name?: string; duration_days?: number; depends_on?: string[] }): Promise<{ id: number }> {
    return request(`/projects/${id}/tasks`, { method: 'POST', body: JSON.stringify(data) })
  },
  updateProjectTask(id: number, taskId: number, data: object): Promise<void> {
    return request(`/projects/${id}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(data) })
  },
  deleteProjectTask(id: number, taskId: number): Promise<void> {
    return request(`/projects/${id}/tasks/${taskId}`, { method: 'DELETE' })
  },
  loadTasksFromPlan(id: number): Promise<{ inserted: number }> {
    return request(`/projects/${id}/tasks/from-plan`, { method: 'POST' })
  },
  getTaskComments(id: number, taskId: number): Promise<{ comments: { id: number; comment: string; created_at: string; suggestions?: string[] }[] }> {
    return request(`/projects/${id}/tasks/${taskId}/comments`)
  },
  addTaskComment(id: number, taskId: number, comment: string): Promise<{ id: number; comment: string; suggestions?: string[] }> {
    return request(`/projects/${id}/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ comment }) })
  },
  draftTaskAssignment(projectId: number, taskId: number): Promise<{ subject: string; body: string; to: string }> {
    return request(`/projects/${projectId}/tasks/${taskId}/assign-email`, { method: 'POST' })
  },
  saveProjectAsTemplate(projectId: number): Promise<{ id: number; name: string; task_count: number }> {
    return request(`/projects/${projectId}/save-as-template`, { method: 'POST' })
  },
  getProjectTemplates(): Promise<{ templates: { id: number; name: string; created_at: string; task_count: number }[] }> {
    return request('/projects/templates')
  },
  createProjectFromTemplate(templateId: number, data: { name: string; description?: string }): Promise<{ id: number; name: string; tasks_created: number }> {
    return request(`/projects/from-template/${templateId}`, { method: 'POST', body: JSON.stringify(data) })
  },
  getClientReport(projectId: number): Promise<{ html: string }> {
    return request(`/projects/${projectId}/client-report`, { method: 'POST' })
  },

  // Project Milestones
  getMilestones(id: number): Promise<{ milestones: { id: number; name: string; due_date: string; status: string; days_until: number | null }[] }> {
    return request(`/projects/${id}/milestones`)
  },
  addMilestone(id: number, data: { name: string; due_date: string }): Promise<{ id: number }> {
    return request(`/projects/${id}/milestones`, { method: 'POST', body: JSON.stringify(data) })
  },
  updateMilestone(id: number, mid: number, data: { status: string }): Promise<void> {
    return request(`/projects/${id}/milestones/${mid}`, { method: 'PATCH', body: JSON.stringify(data) })
  },
  deleteMilestone(id: number, mid: number): Promise<void> {
    return request(`/projects/${id}/milestones/${mid}`, { method: 'DELETE' })
  },
  getProjectBudget(id: number): Promise<{
    budget_total: number
    estimated_cost: number
    actual_cost_estimate: number
    tasks_breakdown: { id: number; phase_name: string; name: string; duration_days: number; hourly_rate: number; estimated_cost: number; status: string }[]
  }> {
    return request(`/projects/${id}/budget`)
  },
  updateProjectBudget(id: number, budget_total: number): Promise<void> {
    return request(`/projects/${id}/budget`, { method: 'PATCH', body: JSON.stringify({ budget_total }) })
  },

  // Send-Time Optimizer
  getBestSendTime(emailAddr: string): Promise<{ suggestion: string | null; best_day: string; best_hour_display: string; top_days: string[]; reason: string }> {
    return request(`/analytics/send-time/${encodeURIComponent(emailAddr)}`)
  },

  // PST / OLM Import
  checkPSTAvailability(): Promise<{ available: boolean; olm_available: boolean; pst_available: boolean; pst_backend?: string; olm_backend?: string; pst_error?: string }> {
    return request('/pst/status')
  },
  importPST(file: File): Promise<{ task_id: string; filename: string }> {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/pst/import`, { method: 'POST', body: form })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail || 'Upload failed'))))
  },
  streamPSTProgress(taskId: string): EventSource {
    return new EventSource(`${BASE}/pst/progress/${taskId}`)
  },
  listPSTTasks(): Promise<{ tasks: any[] }> {
    return request('/pst/tasks')
  },

  // Pre-send AI review
  preSendReview(opts: { to: string; subject: string; body: string; original_email_id?: string }): Promise<{
    tone: string; tone_label: 'good' | 'warning' | 'issue'
    unanswered_questions: string[]; commitments: string[]; suggestions: string[]; ready: boolean
  }> {
    return request('/drafts/review', { method: 'POST', body: JSON.stringify(opts) })
  },

  // CRM
  getCRMDeals(): Promise<{ deals: any[] }> {
    return request('/crm/deals')
  },
  createCRMDeal(data: { name: string; contact_email: string; stage: string; value: string; notes: string }): Promise<{ id: number }> {
    return request('/crm/deals', { method: 'POST', body: JSON.stringify(data) })
  },
  updateCRMDeal(id: number, data: Partial<{ name: string; contact_email: string; stage: string; value: string; notes: string }>): Promise<void> {
    return request(`/crm/deals/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  },
  deleteCRMDeal(id: number): Promise<void> {
    return request(`/crm/deals/${id}`, { method: 'DELETE' })
  },
  extractCRMDeals(): Promise<{ suggestions: any[] }> {
    return request('/crm/deals/extract', { method: 'POST' })
  },
  getCRMDealHistory(id: number): Promise<{ history: { from_stage: string; to_stage: string; changed_at: string; note: string }[] }> {
    return request(`/crm/deals/${id}/history`)
  },
  getCRMKanban(): Promise<{ columns: { stage: string; deals: CRMDeal[] }[] }> {
    return request('/crm/pipeline/kanban')
  },
  getCRMDealEmails(id: number): Promise<{ emails: CRMDealEmail[] }> {
    return request(`/crm/deals/${id}/emails`)
  },
  linkEmailToDeal(dealId: number, emailId: string, direction: string): Promise<{ linked: boolean }> {
    return request(`/crm/deals/${dealId}/emails`, {
      method: 'POST',
      body: JSON.stringify({ email_id: emailId, direction }),
    })
  },
  unlinkDealEmail(dealId: number, emailId: string): Promise<{ unlinked: boolean }> {
    return request(`/crm/deals/${dealId}/emails/${encodeURIComponent(emailId)}`, { method: 'DELETE' })
  },
  draftCRMFollowup(id: number): Promise<{ to: string; subject: string; body: string }> {
    return request(`/crm/deals/${id}/followup-draft`, { method: 'POST' })
  },

  // Social Inbox
  getSocialInbox(params?: { platform?: string; type?: string; unread?: boolean }): Promise<{ messages: SocialMessage[]; total: number }> {
    const q = new URLSearchParams()
    if (params?.platform) q.set('platform', params.platform)
    if (params?.type) q.set('type', params.type)
    if (params?.unread) q.set('unread', 'true')
    const qs = q.toString()
    return request(`/social/inbox${qs ? `?${qs}` : ''}`)
  },
  replySocialMessage(id: string, text: string): Promise<{ ok: boolean; reply_id?: string; error?: string }> {
    return request(`/social/inbox/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
  },
  markSocialRead(id: string): Promise<{ ok: boolean }> {
    return request(`/social/inbox/${encodeURIComponent(id)}/read`, { method: 'POST' })
  },
  syncSocialInbox(platform: string): Promise<{ fetched: number; error?: string; hint?: string }> {
    return request('/social/inbox/sync', { method: 'POST', body: JSON.stringify({ platform }) })
  },
  getSocialUnreadCount(): Promise<{ instagram: number; linkedin: number }> {
    return request('/social/inbox/unread-count')
  },

  // Post performance scoring
  scoreLinkedInPost(data: { post_text: string; hashtags: string[]; scheduled_at?: string }): Promise<PostScore> {
    return request('/social/linkedin/score-post', { method: 'POST', body: JSON.stringify(data) })
  },
  scoreInstagramPost(data: { caption: string; hashtags: string[]; scheduled_at?: string }): Promise<PostScore> {
    return request('/instagram/score-post', { method: 'POST', body: JSON.stringify(data) })
  },

  // LinkedIn voice profile
  learnLinkedInVoice(): Promise<{ profile: LinkedInVoiceProfile | null; posts_analyzed: number; error?: string }> {
    return request('/social/linkedin/learn-voice', { method: 'POST', body: JSON.stringify({}) })
  },
  getLinkedInVoiceProfile(): Promise<{ profile: LinkedInVoiceProfile | null; computed_at: string | null }> {
    return request('/social/linkedin/voice-profile')
  },

  // Backup & Restore
  getBackupStats(): Promise<{ db_size_mb: number; last_modified: number | null }> {
    return request('/backup/stats')
  },
  exportBackupUrl(): string {
    return `${BASE}/backup/export`
  },
  importBackup(file: File): Promise<{ ok: boolean; message: string }> {
    const form = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/backup/import`, { method: 'POST', body: form })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail || 'Restore failed'))))
  },

  // Delegations
  getDelegations(status?: string): Promise<{ delegations: any[] }> {
    const qs = status ? `?status=${status}` : ''
    return request(`/delegations${qs}`)
  },
  createDelegation(data: { email_id: string; subject: string; original_sender: string; delegated_to: string; note?: string }): Promise<{ id: number }> {
    return request('/delegations', { method: 'POST', body: JSON.stringify(data) })
  },
  resolveDelegation(id: number): Promise<void> {
    return request(`/delegations/${id}/resolve`, { method: 'PATCH' })
  },
  deleteDelegation(id: number): Promise<void> {
    return request(`/delegations/${id}`, { method: 'DELETE' })
  },
  autoCheckDelegations(): Promise<{ resolved: number }> {
    return request('/delegations/auto-check', { method: 'POST' })
  },

  // Meeting Prep
  getMeetingPrep(data: { subject: string; attendees: string[]; meeting_date?: string }): Promise<{ brief: string; attendees: string[]; subject: string }> {
    return request('/intelligence/meeting-prep', { method: 'POST', body: JSON.stringify(data) })
  },

  // Board Report
  generateBoardReport(): Promise<{ report: string; period: string; emails_analyzed: number }> {
    return request('/report/board', { method: 'POST' })
  },

  // Overnight Drafts
  getOvernightDrafts(): Promise<{ drafts: any[]; count: number }> {
    return request('/overnight/drafts')
  },

  // Snippets
  getSnippets(): Promise<{ snippets: {id: number; name: string; content: string; shortcut: string}[] }> {
    return request('/snippets')
  },
  createSnippet(data: {name: string; content: string; shortcut?: string}): Promise<{id: number}> {
    return request('/snippets', { method: 'POST', body: JSON.stringify(data) })
  },
  deleteSnippet(id: number): Promise<void> {
    return request(`/snippets/${id}`, { method: 'DELETE' })
  },

  // Signatures
  getSignatures(): Promise<{ signatures: { id: number; name: string; content: string; is_default: number; account_id: number }[] }> {
    return request('/signatures')
  },
  createSignature(data: { name: string; content: string; is_default: boolean; account_id?: number }): Promise<{ id: number; status: string }> {
    return request('/signatures', { method: 'POST', body: JSON.stringify({ account_id: 0, ...data }) })
  },
  updateSignature(id: number, data: { name: string; content: string; is_default: boolean; account_id?: number }): Promise<{ status: string }> {
    return request(`/signatures/${id}`, { method: 'PATCH', body: JSON.stringify({ account_id: 0, ...data }) })
  },
  deleteSignature(id: number): Promise<{ deleted: number }> {
    return request(`/signatures/${id}`, { method: 'DELETE' })
  },
  approveOvernightDraft(id: number): Promise<{ status: string }> {
    return request(`/overnight/drafts/${id}/approve`, { method: 'POST' })
  },
  discardOvernightDraft(id: number): Promise<{ status: string }> {
    return request(`/overnight/drafts/${id}/discard`, { method: 'POST' })
  },
  runOvernightTriageNow(): Promise<{ queued: boolean }> {
    return request('/overnight/run-now', { method: 'POST' })
  },

  // ElevenLabs TTS — returns a URL suitable for Audio src
  readEmailAloud(emailId: string): string {
    return `${BASE}/voice/read/${encodeURIComponent(emailId)}`
  },

  markEmailRead(emailId: string): Promise<{ status: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/read`, { method: 'POST' })
  },
  moveEmail(emailId: string, folder: string): Promise<{ status: string }> {
    return request(`/emails/${encodeURIComponent(emailId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ folder })
    })
  },

  // RAG Stats
  getRagStats(): Promise<{ count: number; collection_size_mb: number; last_indexed: string; embedding_model: string; status: string }> {
    return request('/rag/stats')
  },

  // RAG Embeddings 2D projection
  getRagEmbeddings2d(): Promise<{
    points: { id: string; x: number; y: number; subject: string; sender: string; category: string; date: string }[]
    error?: string
  }> {
    return request('/rag/embeddings-2d')
  },
  classifyBatch(): Promise<{ classified: number; total_unclassified: number }> {
    return request('/emails/classify-batch', { method: 'POST' })
  },

  // Explain cluster (streaming)
  streamExplainCluster(
    emailIds: string[],
    onToken: (text: string) => void,
    onDone: () => void,
    question?: string,
  ): AbortController {
    const ctrl = new AbortController()
    fetch(`${BASE}/ask/explain-cluster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_ids: emailIds, question }),
      signal: ctrl.signal,
    }).then(async (res) => {
      if (!res.body) { onDone(); return }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'token') onToken(evt.text)
            else if (evt.type === 'done') onDone()
          } catch { /* ignore */ }
        }
      }
      onDone()
    }).catch(() => onDone())
    return ctrl
  },

  // Email Rules
  getEmailRules(): Promise<{ rules: any[] }> { return request('/email-rules') },
  createEmailRule(data: { name: string; field: string; condition: string; value: string; action: string; label?: string; priority?: number }): Promise<{ id: number }> {
    return request('/email-rules', { method: 'POST', body: JSON.stringify(data) })
  },
  previewEmailRule(data: { field: string; condition: string; value: string }): Promise<{ count: number; sample: { id: number; subject: string; sender: string }[] }> {
    return request('/email-rules/preview', { method: 'POST', body: JSON.stringify(data) })
  },
  toggleEmailRule(id: number): Promise<void> { return request(`/email-rules/${id}/toggle`, { method: 'PATCH' }) },
  deleteEmailRule(id: number): Promise<void> { return request(`/email-rules/${id}`, { method: 'DELETE' }) },
  runEmailRules(): Promise<{ status: string; deleted: number; labeled: number; archived: number; marked: number }> {
    return request('/email-rules/run', { method: 'POST' })
  },
  getEmailRulesLastRun(): Promise<{ ran_at: string; labeled: number; archived: number; marked: number; deleted: number } | null> {
    return request('/email-rules/last-run')
  },
  rulesFromNL(description: string): Promise<{ rules: { name: string; field: string; condition: string; value: string; action: string; label: string; priority: number }[] }> {
    return request('/email-rules/from-nl', { method: 'POST', body: JSON.stringify({ description }) })
  },

  // Job Tracker
  draftThankYou(jobId: number): Promise<{ subject: string; body: string; to: string }> {
    return request(`/jobs/${jobId}/thank-you`, { method: 'POST' })
  },

  // LinkedIn
  getLinkedInTrends(subject: string): Promise<{ trends: { title: string; description: string; engagement: string; hashtags: string[] }[] }> {
    return request('/social/linkedin/trends', { method: 'POST', body: JSON.stringify({ subject }) })
  },
  generateLinkedInPost(params: { topic: string; audience: string; tone: string; subject: string }): Promise<{ post: string; hashtags: string[]; char_count: number }> {
    return request('/social/linkedin/generate-post', { method: 'POST', body: JSON.stringify(params) })
  },
  generateLinkedInImages(params: { topic: string; post_text: string; custom_prompt?: string }): Promise<{ images: { url: string; prompt: string }[]; error?: string }> {
    return request('/social/linkedin/generate-images', { method: 'POST', body: JSON.stringify(params) })
  },
  saveLinkedInDraft(data: object): Promise<{ id: string }> {
    return request('/social/linkedin/save-draft', { method: 'POST', body: JSON.stringify(data) })
  },
  publishLinkedInPost(data: { id?: string; post_text: string; image_url?: string; content_type: string; scheduled_at?: string }): Promise<{ status: string; linkedin_post_id?: string }> {
    return request('/social/linkedin/publish', { method: 'POST', body: JSON.stringify(data) })
  },
  getLinkedInHistory(): Promise<{ posts: { id: string; subject: string; topic: string; post_text: string; audience: string; tone: string; image_url: string | null; content_type: string; scheduled_at: string | null; published_at: string | null; linkedin_post_id: string | null; status: string; created_at: string }[] }> {
    return request('/social/linkedin/history')
  },
  deleteLinkedInPost(id: string): Promise<void> {
    return request(`/social/linkedin/history/${id}`, { method: 'DELETE' })
  },
  rescheduleLinkedInPost(id: string, scheduled_at: string): Promise<{ status: string; scheduled_for: string }> {
    return request(`/social/linkedin/history/${id}/reschedule`, { method: 'POST', body: JSON.stringify({ scheduled_at }) })
  },
  getLinkedInAutopilot(): Promise<{ config: { id: number; topics: string[]; template_id: string | null; content_type: string; interval_days: number; post_time: string; enabled: number; topic_index: number; last_post_at: string | null; next_post_at: string | null } | null }> {
    return request('/social/linkedin/autopilot')
  },
  saveLinkedInAutopilot(data: { topics: string[]; template_id?: string | null; content_type: string; interval_days: number; post_time: string; enabled: boolean; next_post_at?: string; topic_index?: number }): Promise<{ status: string }> {
    return request('/social/linkedin/autopilot', { method: 'POST', body: JSON.stringify(data) })
  },
  deleteLinkedInAutopilot(): Promise<{ status: string }> {
    return request('/social/linkedin/autopilot', { method: 'DELETE' })
  },
  async extractTopicsFromFile(file: File): Promise<{ topics: string[]; error?: string }> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/social/linkedin/autopilot/extract-topics`, { method: 'POST', body: form })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Upload failed') }
    return res.json()
  },
  getLinkedInSettings(): Promise<{ client_id: string; client_secret: string; access_token: string; user_id: string; custom_prompts: string[] }> {
    return request('/social/linkedin/settings')
  },
  saveLinkedInSettings(data: { client_id?: string; client_secret?: string; access_token?: string; user_id?: string; custom_prompts?: string[] }): Promise<void> {
    return request('/social/linkedin/settings', { method: 'POST', body: JSON.stringify(data) })
  },

  // LinkedIn Prompt Templates
  getLinkedInTemplates(): Promise<{ templates: { id: string; name: string; prompt: string; sample_image: string; builtin: number; icon?: string }[] }> {
    return request('/social/linkedin/templates')
  },
  saveLinkedInTemplate(data: { name: string; prompt: string; sample_image?: string }): Promise<{ id: string; name: string; prompt: string; sample_image: string; builtin: number }> {
    return request('/social/linkedin/templates', { method: 'POST', body: JSON.stringify(data) })
  },
  deleteLinkedInTemplate(id: string): Promise<void> {
    return request(`/social/linkedin/templates/${id}`, { method: 'DELETE' })
  },

  // LinkedIn Connectivity Verify
  verifyLinkedIn(): Promise<{ linkedin: { ok: boolean; message: string }; openai: { ok: boolean; message: string }; ai_provider: { ok: boolean; message: string } }> {
    return request('/social/linkedin/verify', { method: 'POST' })
  },

  // Card Studio
  getBrandKit(): Promise<{ primary_color: string; accent_color: string; text_color: string; bg_style: string; logo_url: string; author_name: string; tagline: string }> {
    return request('/social/card/brand-kit')
  },
  saveBrandKit(data: object): Promise<{ saved: boolean }> {
    return request('/social/card/brand-kit', { method: 'POST', body: JSON.stringify(data) })
  },
  generateCard(data: { card_type: string; content: object; brand: object }): Promise<{ image_b64: string }> {
    return request('/social/card/generate', { method: 'POST', body: JSON.stringify(data) })
  },
  generateCardCaption(data: { card_type: string; content: object; platform: string; tone: string }): Promise<{ caption: string; hashtags: string[] }> {
    return request('/social/card/generate-caption', { method: 'POST', body: JSON.stringify(data) })
  },
  postCard(data: { image_b64: string; caption: string; hashtags: string[]; platforms: string[] }): Promise<{ results: { platform: string; status: string; error?: string }[] }> {
    return request('/social/card/post', { method: 'POST', body: JSON.stringify(data) })
  },

  // Instagram
  getInstagramSettings(): Promise<{ access_token: string; ig_user_id: string; image_model: string }> {
    return request('/instagram/settings')
  },
  saveInstagramSettings(data: { access_token?: string; ig_user_id?: string; image_model?: string }): Promise<void> {
    return request('/instagram/settings', { method: 'POST', body: JSON.stringify(data) })
  },
  generateInstagramCaption(data: { topic: string; tone: string; hashtag_count: number }): Promise<{ caption: string; hashtags: string[] }> {
    return request('/instagram/generate-caption', { method: 'POST', body: JSON.stringify(data) })
  },
  generateInstagramImage(data: { topic: string; caption: string; custom_prompt?: string }): Promise<{ url: string; prompt: string }> {
    return request('/instagram/generate-image', { method: 'POST', body: JSON.stringify(data) })
  },
  publishInstagramPost(data: { caption: string; hashtags: string[]; image_url?: string; content_type: string; scheduled_at?: string }): Promise<{ status: string; ig_media_id?: string }> {
    return request('/instagram/publish', { method: 'POST', body: JSON.stringify(data) })
  },
  getInstagramHistory(): Promise<{ posts: { id: string; caption: string; hashtags: string[]; image_url: string | null; content_type: string; status: string; ig_media_id: string | null; scheduled_at: string | null; published_at: string | null; created_at: string }[] }> {
    return request('/instagram/history')
  },
  deleteInstagramPost(id: string): Promise<void> {
    return request(`/instagram/history/${id}`, { method: 'DELETE' })
  },
  verifyInstagram(): Promise<{ instagram: { ok: boolean; message: string } }> {
    return request('/instagram/verify', { method: 'POST' })
  },
  getInstagramAutopilot(): Promise<{ config: any }> {
    return request('/instagram/autopilot')
  },
  saveInstagramAutopilot(data: object): Promise<void> {
    return request('/instagram/autopilot', { method: 'POST', body: JSON.stringify(data) })
  },
  deleteInstagramAutopilot(): Promise<void> {
    return request('/instagram/autopilot', { method: 'DELETE' })
  },
  getInstagramTemplates(): Promise<{ templates: any[] }> {
    return request('/instagram/templates')
  },
  saveInstagramTemplate(data: object): Promise<{ id: string }> {
    return request('/instagram/templates', { method: 'POST', body: JSON.stringify(data) })
  },
  updateInstagramTemplate(id: string, data: object): Promise<void> {
    return request(`/instagram/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  },
  deleteInstagramTemplate(id: string): Promise<void> {
    return request(`/instagram/templates/${id}`, { method: 'DELETE' })
  },

  // Natural-language inbox commands
  parseNLCommand(command: string): Promise<NLCommandPreview> {
    return request('/emails/nl-command/parse', {
      method: 'POST',
      body: JSON.stringify({ command }),
    })
  },
  executeNLCommand(commandId: number): Promise<{ executed: number; action: string; email_ids: string[] }> {
    return request('/emails/nl-command/execute', {
      method: 'POST',
      body: JSON.stringify({ command_id: commandId }),
    })
  },
  undoNLCommand(commandId: number): Promise<{ undone: number; message: string }> {
    return request('/emails/nl-command/undo', {
      method: 'POST',
      body: JSON.stringify({ command_id: commandId }),
    })
  },

  getAutopilotRules: (): Promise<{ rules: AutopilotRule[] }> => request('/autopilot/rules'),
  addAutopilotRule: (data: { email_addr: string; display_name?: string; mode: string; prompt_hint?: string }): Promise<{ id: number; status: string }> =>
    request('/autopilot/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateAutopilotRule: (id: number, data: { mode: string; prompt_hint?: string }): Promise<{ status: string }> =>
    request(`/autopilot/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAutopilotRule: (id: number): Promise<{ status: string }> =>
    request(`/autopilot/rules/${id}`, { method: 'DELETE' }),
  previewAutopilotReply: (emailId: string): Promise<{ draft: string; email_id: string }> =>
    request(`/autopilot/preview/${emailId}`, { method: 'POST' }),
  getAutopilotActivity: (): Promise<{ activity: { id: number; email_id: string; sender: string; subject: string; action: string; created_at: string }[] }> =>
    request('/autopilot/activity'),
  triggerAutopilotReply: (emailId: string): Promise<{ status: string; mode: string; preview?: string }> =>
    request(`/autopilot/trigger/${emailId}`, { method: 'POST' }),
}

export interface NLCommandPreviewEmail {
  id: string
  subject: string
  sender: string
  date: string | null
}

export interface NLCommandPreview {
  action: string
  filters: Record<string, unknown>
  preview: NLCommandPreviewEmail[]
  count: number
  safe: boolean
  command_id: number
}
