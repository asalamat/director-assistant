import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useUIContext } from '../../contexts/UIContext'
import type { ContactHealth, ContactHealthResponse } from '../../types'

type StatusFilter = ContactHealth['status'] | null
type PillFilter = 'all' | 'at_risk' | 'awaiting' | 'warming'

const STATUS_META: Record<ContactHealth['status'], { ring: string; text: string; chip: string; icon: string; label: string }> = {
  healthy: { ring: 'border-green-500', text: 'text-green-600', chip: 'bg-green-50 text-green-700', icon: '🟢', label: 'Healthy' },
  good: { ring: 'border-blue-500', text: 'text-blue-600', chip: 'bg-blue-50 text-blue-700', icon: '🟡', label: 'Good' },
  fading: { ring: 'border-amber-500', text: 'text-amber-600', chip: 'bg-amber-50 text-amber-700', icon: '🟠', label: 'Fading' },
  at_risk: { ring: 'border-red-500', text: 'text-red-600', chip: 'bg-red-50 text-red-700', icon: '🔴', label: 'At Risk' },
  cold: { ring: 'border-gray-400', text: 'text-gray-500', chip: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300', icon: '⚫', label: 'Cold' },
}

const TREND_ICON: Record<ContactHealth['trend'], string> = { warming: '🔥', cooling: '❄️', stable: '➡️' }

const PILLS: { id: PillFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'at_risk', label: 'At Risk' },
  { id: 'awaiting', label: 'Awaiting Reply' },
  { id: 'warming', label: 'Warming' },
]

export function ContactHealthTab() {
  const { openCompose } = useUIContext()
  const [data, setData] = useState<ContactHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null)
  const [pill, setPill] = useState<PillFilter>('all')

  const load = () => {
    setLoading(true); setError('')
    api.getContactHealth()
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load contact health'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const contacts = (data?.contacts ?? []).filter(c => {
    if (statusFilter && c.status !== statusFilter) return false
    if (pill === 'at_risk' && c.status !== 'at_risk') return false
    if (pill === 'awaiting' && !c.awaiting_reply) return false
    if (pill === 'warming' && c.trend !== 'warming') return false
    return true
  })

  const s = data?.summary
  const chips: { status: ContactHealth['status']; count: number }[] = s ? [
    { status: 'healthy', count: s.healthy },
    { status: 'good', count: s.good },
    { status: 'fading', count: s.fading },
    { status: 'at_risk', count: s.at_risk },
    { status: 'cold', count: s.cold },
  ] : []

  return (
    <div className="flex flex-col h-full p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Contact Health</h2>
        <button onClick={load} className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">Refresh</button>
      </div>

      {s && (
        <div className="flex flex-wrap gap-2">
          {chips.map(({ status, count }) => {
            const m = STATUS_META[status]
            const active = statusFilter === status
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(active ? null : status)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${m.chip} ${active ? 'ring-2 ring-offset-1 ring-current dark:ring-offset-gray-900' : 'opacity-90 hover:opacity-100'}`}
              >
                {m.icon} {m.label} ({count})
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {PILLS.map(p => (
          <button
            key={p.id}
            onClick={() => setPill(p.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${pill === p.id ? 'bg-accent text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
        {loading && [0, 1, 2].map(i => (
          <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex items-center gap-4 animate-pulse">
            <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-2 w-1/2 bg-gray-100 dark:bg-gray-800 rounded" />
            </div>
          </div>
        ))}

        {!loading && error && (
          <div className="text-center py-8">
            <p className="text-sm text-red-500 mb-2">{error}</p>
            <button onClick={load} className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium">Retry</button>
          </div>
        )}

        {!loading && !error && (data?.contacts.length ?? 0) === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">Add VIP contacts to track relationship health.</p>
        )}

        {!loading && !error && (data?.contacts.length ?? 0) > 0 && contacts.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No contacts match this filter.</p>
        )}

        {!loading && !error && contacts.map(c => {
          const m = STATUS_META[c.status]
          return (
            <div key={c.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex items-center gap-4">
              <div className={`flex-shrink-0 w-12 h-12 rounded-full border-2 ${m.ring} flex items-center justify-center font-bold text-sm ${m.text}`}>
                {c.score}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{c.name}</div>
                <div className="text-xs text-gray-400 truncate">{c.email}</div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                  <span className="text-xs" title={c.trend}>{TREND_ICON[c.trend]}</span>
                  {c.awaiting_reply && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">⏳ Awaiting reply</span>
                  )}
                  {c.open_commitments > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">📋 {c.open_commitments} commitment{c.open_commitments > 1 ? 's' : ''}</span>
                  )}
                  {c.active_deal && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 truncate max-w-[160px]">{c.active_deal.stage}</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  {c.days_since_contact !== null ? `Last contact: ${c.days_since_contact} days ago` : 'Never contacted'}
                </p>
              </div>
              <button
                onClick={() => openCompose({ to: c.email })}
                className="flex-shrink-0 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                ✉ Message
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
