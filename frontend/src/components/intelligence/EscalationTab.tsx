import { useEffect, useState } from 'react'
import { api } from '../../api/client'

const PERIODS = [7, 14, 30]

type Escalation = {
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
}

export function EscalationTab({ onViewThread }: { onViewThread?: (subject: string) => void }) {
  const [days, setDays] = useState(14)
  const [items, setItems] = useState<Escalation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    api.getEscalations(days)
      .then(r => { if (!cancelled) setItems(r.escalations) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load escalations') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const barColor = (s: number) => (s >= 70 ? 'bg-red-500' : s >= 40 ? 'bg-amber-500' : 'bg-green-500')

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Escalation Radar</h2>
        <p className="text-xs text-gray-500 mt-0.5">Threads heating up before they become crises.</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Last:</span>
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => setDays(p)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              days === p ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {p}d
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="text-sm text-green-600">🟢 No escalating threads detected</p>
      )}

      <div className="space-y-3">
        {items.map(e => (
          <div key={e.thread_key} className="border border-gray-200 rounded-xl p-4 flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-gray-900 leading-snug">{e.subject}</span>
              <span className="flex-shrink-0 text-xs font-bold text-gray-400">{e.escalation_score}</span>
            </div>

            <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor(e.escalation_score)}`}
                style={{ width: `${e.escalation_score}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {e.has_urgency && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">🔴 Urgent</span>
              )}
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                👥 {e.participant_count} {e.participant_count === 1 ? 'person' : 'people'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                💬 {e.reply_count} replies
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                e.hours_since_last < 24 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
              }`}>
                ⏱ {Math.round(e.hours_since_last)}h ago
              </span>
            </div>

            {e.senders_preview.length > 0 && (
              <p className="text-xs text-gray-400 truncate">{e.senders_preview.join(', ')}</p>
            )}

            <div className="pt-0.5">
              <button
                onClick={() => onViewThread?.(e.subject)}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                View thread
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
