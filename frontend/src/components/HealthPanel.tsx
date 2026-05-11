import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

interface HealthData {
  overall: 'ok' | 'degraded' | 'error'
  backend: { status: string }
  rag: { status: string; indexed_emails: number; total_chunks: number; error?: string }
  database: { status: string; cached_emails: number; size_mb: number; error?: string }
  ai: {
    anthropic: { status: string; has_key: boolean; key_preview: string; model: string }
    openai: { status: string; has_key: boolean; key_preview: string; model: string; role: string }
    budget_mode: boolean
  }
  poll: { status: string; last_checked: string; last_new: number; last_error: string }
  accounts: { id: number; username: string; provider: string; imap_status: string }[]
}

function Dot({ status }: { status: string }) {
  const color =
    status === 'ok' || status === 'configured' ? 'bg-green-500' :
    status === 'not_configured' || status === 'not_tested' || status === 'waiting' ? 'bg-yellow-400' :
    status === 'degraded' ? 'bg-orange-400' :
    'bg-red-500'
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
}

function Row({ label, status, detail, sub }: {
  label: string; status: string; detail?: string; sub?: string
}) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-gray-100 last:border-0">
      <Dot status={status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-gray-800">{label}</span>
          {detail && <span className="text-xs text-gray-500 flex-shrink-0">{detail}</span>}
        </div>
        {sub && <p className="text-xs text-gray-400 mt-0.5 truncate" title={sub}>{sub}</p>}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">{title}</p>
      <div className="bg-white border border-gray-200 rounded-xl px-3 divide-y divide-gray-100">
        {children}
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  if (!iso) return 'never'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

export function HealthPanel() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [imapChecking, setImapChecking] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (checkImap = true) => {
    if (checkImap) setImapChecking(true)
    else setLoading(true)
    setError('')
    try {
      // Always test IMAP on manual load; skip on background auto-refresh to avoid spam
      const url = `/api/health/full?check_imap=${checkImap}`
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load health data')
    } finally {
      setLoading(false)
      setImapChecking(false)
    }
  }, [])

  useEffect(() => {
    load(true)  // full test including IMAP on first open
    // Auto-refresh skips IMAP (fast, no network spam every 30s)
    const id = setInterval(() => load(false), 30000)
    return () => clearInterval(id)
  }, [load])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-500 text-sm">{error}</div>
    )
  }

  if (!data) return null

  const overallColor =
    data.overall === 'ok' ? 'text-green-600 bg-green-50 border-green-200' :
    data.overall === 'degraded' ? 'text-orange-600 bg-orange-50 border-orange-200' :
    'text-red-600 bg-red-50 border-red-200'

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
      {/* Overall banner */}
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium mb-5 ${overallColor}`}>
        <Dot status={data.overall} />
        System {data.overall === 'ok' ? 'healthy' : data.overall === 'degraded' ? 'degraded — check below' : 'error'}
        <button
          onClick={() => load(true)}
          disabled={imapChecking || loading}
          className="ml-auto text-xs font-normal opacity-70 hover:opacity-100 disabled:opacity-40"
        >
          {imapChecking ? '↻ Testing…' : '↻ Refresh'}
        </button>
      </div>

      {/* Infrastructure */}
      <Section title="Infrastructure">
        <Row label="Backend API" status={data.backend.status} detail="Port 8000" />
        <Row
          label="Database"
          status={data.database.status}
          detail={data.database.status === 'ok' ? `${data.database.size_mb} MB` : ''}
          sub={data.database.status === 'ok'
            ? `${data.database.cached_emails.toLocaleString()} emails cached`
            : data.database.error}
        />
        <Row
          label="RAG Vector Index"
          status={data.rag.status}
          detail={data.rag.status === 'ok' ? `${data.rag.total_chunks.toLocaleString()} chunks` : ''}
          sub={data.rag.status === 'ok'
            ? `${data.rag.indexed_emails.toLocaleString()} emails indexed`
            : data.rag.error}
        />
      </Section>

      {/* AI Providers */}
      <Section title="AI Providers">
        <Row
          label="Claude (Anthropic) — Primary"
          status={data.ai.anthropic.status}
          detail={data.ai.anthropic.key_preview || 'No key'}
          sub={data.ai.anthropic.has_key
            ? `Model: ${data.ai.anthropic.model}${data.ai.budget_mode ? ' — budget mode' : ''}`
            : 'Add key in Settings → App Settings'}
        />
        <Row
          label="ChatGPT (OpenAI) — Backup"
          status={data.ai.openai.status}
          detail={data.ai.openai.key_preview || 'No key'}
          sub={data.ai.openai.has_key
            ? `Model: ${data.ai.openai.model} · ${data.ai.openai.role}`
            : 'Optional — auto-used when Claude hits daily limit'}
        />
        {data.ai.budget_mode && (
          <div className="py-2 text-xs text-amber-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
            Budget mode ON — all calls use cheapest models (Haiku / gpt-4o-mini)
          </div>
        )}
      </Section>

      {/* Email Accounts */}
      <Section title="Email Accounts">
        {data.accounts.length === 0 ? (
          <div className="py-3 text-xs text-gray-400">No accounts configured</div>
        ) : (
          data.accounts.map(acc => (
            <Row
              key={acc.id}
              label={acc.username}
              status={acc.imap_status === 'ok' ? 'ok' : acc.imap_status === 'not_tested' ? 'not_tested' : 'error'}
              detail={acc.provider.replace('_imap', '').replace('EmailProviderType.', '').toUpperCase()}
              sub={acc.imap_status === 'not_tested' ? 'Click "Test IMAP" to verify connection' : acc.imap_status === 'ok' ? 'IMAP login verified' : acc.imap_status}
            />
          ))
        )}
        <div className="py-2 flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={imapChecking}
            className="text-xs text-accent hover:underline disabled:opacity-50"
          >
            {imapChecking ? 'Testing…' : 'Re-test connections'}
          </button>
          <span className="text-xs text-gray-400">(8s timeout — fails immediately if offline)</span>
        </div>
      </Section>

      {/* Background Poll */}
      <Section title="Background Email Polling">
        <Row
          label="Auto-poll"
          status={data.poll.status}
          detail={data.poll.last_checked ? timeAgo(data.poll.last_checked) : 'waiting…'}
          sub={data.poll.last_error
            ? `Error: ${data.poll.last_error}`
            : data.poll.last_new > 0
            ? `Last run: +${data.poll.last_new} new emails`
            : data.poll.last_checked ? 'No new emails last check' : 'First check pending (waits 20s after startup)'}
        />
      </Section>
    </div>
  )
}
