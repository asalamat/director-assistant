import type {
  EmailSummary,
  EmailMessage,
  AIRecommendation,
  IngestProgress,
  ConnectionStatus,
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
    rag: { total_chunks: number; unique_emails_indexed: number; db_size_bytes: number; db_size_mb: number }
    ingest: { status: string; processed: number; total: number; message: string }
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
}
