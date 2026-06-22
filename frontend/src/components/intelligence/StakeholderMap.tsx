import { useEffect, useState } from 'react'
import { api } from '../../api/client'

type Stakeholder = {
  name: string
  email: string
  received_count: number
  sent_count: number
  total_interactions: number
  influence_score: number
  last_contact: string | null
  is_vip: boolean
}

const PERIODS = [30, 90, 180]

function scoreColor(score: number): string {
  if (score >= 60) return 'bg-blue-500'
  if (score >= 30) return 'bg-amber-500'
  return 'bg-gray-400'
}

export function StakeholderMap({ onEmailContact }: { onEmailContact: (email: string) => void }) {
  const [days, setDays] = useState(90)
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    api.getStakeholders(days)
      .then(r => { if (!cancelled) setStakeholders(r.stakeholders) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load stakeholders') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Stakeholder Influence Map</h2>
        <p className="text-xs text-gray-500 mt-0.5">Your most influential contacts, ranked by interaction volume.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">Last</span>
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
        {!loading && (
          <span className="ml-auto px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            {stakeholders.length} stakeholders
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && stakeholders.length === 0 && (
        <p className="text-sm text-gray-400">No stakeholder data for this period yet.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {stakeholders.map(s => (
          <div key={s.email} className="border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <div className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold ${scoreColor(s.influence_score)}`}>
                {s.influence_score}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-sm text-gray-900 truncate">{s.name}</span>
                  {s.is_vip && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-purple-100 text-purple-700">★ VIP</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 truncate">{s.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
              <span title="Received from them">📥 {s.received_count}</span>
              <span className="text-gray-300">·</span>
              <span title="Sent to them">📤 {s.sent_count}</span>
              {s.last_contact && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>Last: {s.last_contact}</span>
                </>
              )}
            </div>

            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${scoreColor(s.influence_score)}`} style={{ width: `${s.influence_score}%` }} />
            </div>

            <button
              onClick={() => onEmailContact(s.email)}
              className="self-start px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
            >
              Email
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
