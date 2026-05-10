import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

interface Stats {
  rag: { total_chunks: number; unique_emails_indexed: number; cached_emails: number; db_size_mb: number }
  ingest: { status: string; processed: number; total: number; message: string }
  poll: { interval_seconds: number; last_checked: string; last_new: number }
  accounts: { id: number; username: string; provider: string; last_ingested: string | null }[]
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-gray-300',
  running: 'bg-blue-500 animate-pulse',
  completed: 'bg-green-500',
  error: 'bg-red-500',
}

function fmt(n: number) { return n.toLocaleString() }

function timeAgo(iso: string): string {
  if (!iso) return 'never'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

const PROVIDER_SHORT: Record<string, string> = {
  yahoo_imap: 'Yahoo',
  gmail:      'Gmail',
  hotmail:    'Hotmail',
  office365:  'O365',
  generic_imap: 'IMAP',
}

export function StatusBar() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [tick, setTick] = useState(0)   // force re-render for relative time

  const load = useCallback(() => {
    api.getStats().then((s: unknown) => setStats(s as Stats)).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const statsId = setInterval(load, 5000)
    const tickId  = setInterval(() => setTick((t) => t + 1), 10000)
    return () => { clearInterval(statsId); clearInterval(tickId) }
  }, [load])

  if (!stats) return null

  const { rag, ingest, poll, accounts } = stats
  const pct = ingest.total > 0 ? Math.round((ingest.processed / ingest.total) * 100) : 0

  return (
    <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50">
      {/* Account pills row */}
      {accounts.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1 border-b border-gray-100 overflow-x-auto">
          {accounts.map((a) => (
            <span key={a.id} className="flex items-center gap-1 text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              <span className="font-medium text-gray-700">{PROVIDER_SHORT[a.provider] ?? a.provider}</span>
              <span className="truncate max-w-[120px]">{a.username}</span>
            </span>
          ))}
          <span className="text-xs text-gray-400 ml-auto whitespace-nowrap flex-shrink-0">
            Checked {timeAgo(poll.last_checked)}
            {poll.last_new > 0 && (
              <span className="ml-1 text-green-600 font-medium">+{poll.last_new} new</span>
            )}
          </span>
        </div>
      )}

      {/* Stats row */}
      <div className="h-7 flex items-center gap-4 px-4 text-xs text-gray-500">
        <span title="Emails saved to local cache">
          <span className="text-gray-400">Cache</span>{' '}
          <span className="font-medium text-gray-700">{fmt(rag.cached_emails)}</span>
        </span>

        <span className="text-gray-200">|</span>

        <span title="Unique emails in RAG vector index">
          <span className="text-gray-400">RAG</span>{' '}
          <span className="font-medium text-gray-700">{fmt(rag.unique_emails_indexed)}</span>
          {' / '}
          <span className="font-medium text-gray-700">{fmt(rag.total_chunks)}</span>
          <span className="text-gray-400"> chunks</span>
        </span>

        <span className="text-gray-200">|</span>

        <span title="Database disk usage">
          <span className="text-gray-400">DB</span>{' '}
          <span className="font-medium text-gray-700">{rag.db_size_mb} MB</span>
        </span>

        <span className="text-gray-200">|</span>

        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[ingest.status] ?? 'bg-gray-300'}`} />
          {ingest.status === 'running' ? (
            <>
              <span>Ingesting</span>
              <span className="font-medium text-gray-700">{fmt(ingest.processed)}</span>
              {ingest.total > 0 && (
                <>/<span className="font-medium text-gray-700">{fmt(ingest.total)}</span>
                  <span className="text-gray-400">({pct}%)</span>
                </>
              )}
            </>
          ) : ingest.status === 'completed' ? (
            <span className="text-green-600">Ingested</span>
          ) : ingest.status === 'error' ? (
            <span className="text-red-500" title={ingest.message}>Ingest error</span>
          ) : (
            <span>Idle</span>
          )}
        </span>

        <span className="text-gray-200">|</span>

        <span title={`Auto-checks every ${poll.interval_seconds}s`} className="text-gray-400">
          Poll: {poll.interval_seconds}s
        </span>
      </div>
    </div>
  )
}
