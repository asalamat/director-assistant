import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useUIContext } from '../../contexts/UIContext'
import type { RelationshipNudge } from '../../types'

const THRESHOLDS = [14, 21, 30]
const SNOOZE_OPTIONS = [
  { label: '7 days',  days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

export function NudgesTab() {
  const { openCompose } = useUIContext()
  const [days, setDays] = useState(21)
  const [nudges, setNudges] = useState<RelationshipNudge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dismissingEmail, setDismissingEmail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    api.getNudges(days)
      .then(r => { if (!cancelled) setNudges(r.nudges) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load nudges') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const dismiss = async (email: string, snoozeDays = 30) => {
    setNudges(prev => prev.filter(n => n.email !== email))
    try {
      await api.dismissNudge(email, snoozeDays)
    } catch { /* optimistic — local remove already done */ }
    setDismissingEmail(null)
  }

  const ageColor = (d: number) =>
    d >= 30 ? 'text-red-600 bg-red-50' : d >= 14 ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-50'

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Relationship Nudges</h2>
        <p className="text-xs text-gray-500 mt-0.5">Important contacts you haven't reached out to recently.</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Contacts quiet for:</span>
        {THRESHOLDS.map(t => (
          <button
            key={t}
            onClick={() => setDays(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              days === t
                ? 'bg-accent text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t}d
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && nudges.length === 0 && (
        <p className="text-sm text-gray-400">No nudges — you're on top of your relationships. 🎉</p>
      )}

      <div className="space-y-3">
        {nudges.map(n => (
          <div key={n.email} className="border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 truncate">{n.name}</span>
                  {n.is_vip && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-purple-100 text-purple-700">VIP</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 truncate">{n.email}</p>
              </div>
              <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${ageColor(n.days_since)}`}>
                {n.last_contact_date ? `${n.days_since} days ago` : 'never'}
              </span>
            </div>

            {n.last_subject && (
              <p className="text-xs text-gray-500 truncate">Last: {n.last_subject}</p>
            )}

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                onClick={() => openCompose({ to: n.email })}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                Email now
              </button>
              {dismissingEmail === n.email ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">Snooze for:</span>
                  {SNOOZE_OPTIONS.map(opt => (
                    <button
                      key={opt.days}
                      onClick={() => dismiss(n.email, opt.days)}
                      className="px-2 py-1 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-accent hover:text-white transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setDismissingEmail(null)}
                    className="text-gray-400 hover:text-gray-600 text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDismissingEmail(n.email)}
                  className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
