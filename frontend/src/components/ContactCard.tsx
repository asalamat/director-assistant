import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { SenderStats } from '../types'

interface Props {
  sender: string
  onClose: () => void
  onSearch?: (sender: string) => void
}

export function ContactCard({ sender, onClose, onSearch }: Props) {
  const [stats, setStats] = useState<SenderStats | null>(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getSenderStats(sender)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [sender])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const displayName = sender.match(/^([^<]+)</) ?.[1]?.trim() || sender
  const email = sender.match(/<([^>]+)>/) ?.[1] || sender

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-72 text-sm"
      style={{ top: '100%', left: 0 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center text-base font-bold flex-shrink-0">
          {displayName[0]?.toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{displayName}</p>
          <p className="text-xs text-gray-400 truncate">{email}</p>
        </div>
        <button onClick={onClose} className="ml-auto text-gray-300 hover:text-gray-500 flex-shrink-0">✕</button>
      </div>

      {loading && <p className="text-xs text-gray-400 text-center py-3">Loading…</p>}

      {stats && !loading && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-lg font-bold text-gray-800">{stats.total_emails}</p>
              <p className="text-[10px] text-gray-400">emails</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-xs font-semibold text-gray-700">{stats.first_contact?.slice(0, 10) ?? '—'}</p>
              <p className="text-[10px] text-gray-400">first</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-xs font-semibold text-gray-700">{stats.last_contact?.slice(0, 10) ?? '—'}</p>
              <p className="text-[10px] text-gray-400">last</p>
            </div>
          </div>

          {stats.recent_subjects.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Recent subjects</p>
              {stats.recent_subjects.slice(0, 4).map((s, i) => (
                <p key={i} className="text-xs text-gray-600 truncate py-0.5 border-b border-gray-50 last:border-0">· {s}</p>
              ))}
            </div>
          )}

          {onSearch && (
            <button
              onClick={() => { onSearch(email); onClose() }}
              className="w-full text-xs text-accent hover:underline text-left mt-1"
            >
              Search all emails from this sender →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
