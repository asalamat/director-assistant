import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

interface Stats {
  rag: { total_chunks: number; unique_emails_indexed: number; cached_emails: number; db_size_mb: number }
  ingest: { status: string; processed: number; total: number; message: string }
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-gray-300',
  running: 'bg-blue-500 animate-pulse',
  completed: 'bg-green-500',
  error: 'bg-red-500',
}

function fmt(n: number): string {
  return n.toLocaleString()
}

export function StatusBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  const load = useCallback(() => {
    api.getStats().then(setStats).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  if (!stats) return null

  const { rag, ingest } = stats
  const pct = ingest.total > 0 ? Math.round((ingest.processed / ingest.total) * 100) : 0

  return (
    <div className="h-7 flex items-center gap-4 px-4 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex-shrink-0">
      {/* RAG index */}
      <span title="Emails saved to local cache (SQLite)">
        <span className="text-gray-400">Cache</span>{' '}
        <span className="font-medium text-gray-700">{fmt(rag.cached_emails)}</span>
      </span>

      <span className="text-gray-200">|</span>

      <span title="Unique emails indexed in vector RAG">
        <span className="text-gray-400">RAG</span>{' '}
        <span className="font-medium text-gray-700">{fmt(rag.unique_emails_indexed)}</span>
        {' / '}
        <span className="font-medium text-gray-700">{fmt(rag.total_chunks)}</span> chunks
      </span>

      <span className="text-gray-200">|</span>

      {/* DB size */}
      <span title="ChromaDB disk size">
        <span className="text-gray-400">DB</span>{' '}
        <span className="font-medium text-gray-700">{rag.db_size_mb} MB</span>
      </span>

      <span className="text-gray-200">|</span>

      {/* Ingest status */}
      <span className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[ingest.status] ?? 'bg-gray-300'}`} />
        {ingest.status === 'running' ? (
          <>
            <span>Ingesting</span>
            <span className="font-medium text-gray-700">{fmt(ingest.processed)}</span>
            {ingest.total > 0 && (
              <>
                <span>/</span>
                <span className="font-medium text-gray-700">{fmt(ingest.total)}</span>
                <span className="text-gray-400">({pct}%)</span>
              </>
            )}
          </>
        ) : ingest.status === 'completed' ? (
          <span className="text-green-600">Ingestion complete</span>
        ) : ingest.status === 'error' ? (
          <span className="text-red-500" title={ingest.message}>Ingest error</span>
        ) : (
          <span>Not ingesting</span>
        )}
      </span>
    </div>
  )
}
