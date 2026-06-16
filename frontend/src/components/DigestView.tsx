import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { DigestResponse } from '../types'

export function DigestView() {
  const [digest, setDigest] = useState<DigestResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hours, setHours] = useState(24)

  // Schedule state
  const [showSchedule, setShowSchedule] = useState(false)
  const [schedEnabled, setSchedEnabled] = useState(false)
  const [schedTime, setSchedTime] = useState('08:00')
  const [schedEmail, setSchedEmail] = useState('')
  const [schedSaving, setSchedSaving] = useState(false)
  const [schedSaved, setSchedSaved] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setDigest(await api.getDigest(hours))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate digest')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    api.getConfig().then(cfg => {
      setSchedEnabled(cfg.digest_schedule_enabled ?? false)
      setSchedTime(cfg.digest_schedule_time ?? '08:00')
      setSchedEmail(cfg.digest_schedule_email ?? '')
    }).catch(() => {})
  }, [])

  const saveSchedule = async () => {
    setSchedSaving(true)
    await api.saveConfig({
      digest_schedule_enabled: schedEnabled,
      digest_schedule_time: schedTime,
      digest_schedule_email: schedEmail,
    }).catch(() => {})
    setSchedSaving(false)
    setSchedSaved(true)
    setTimeout(() => setSchedSaved(false), 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Morning Brief</h2>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            <option value={12}>Last 12h</option>
            <option value={24}>Last 24h</option>
            <option value={48}>Last 48h</option>
            <option value={168}>Last 7 days</option>
          </select>
          <button
            onClick={() => setShowSchedule(s => !s)}
            className={`text-xs px-3 py-1 rounded border transition-colors ${
              schedEnabled
                ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {schedEnabled ? '⏰ Scheduled ✓' : '⏰ Schedule'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="text-xs bg-accent text-white px-3 py-1 rounded disabled:opacity-50 hover:bg-blue-700"
          >
            {loading ? 'Generating…' : 'Refresh'}
          </button>
        </div>
      </div>

      {showSchedule && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-700">Auto-generate &amp; email daily brief</p>

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-700" htmlFor="sched-enabled">Enable</label>
            <button
              id="sched-enabled"
              role="switch"
              aria-checked={schedEnabled}
              onClick={() => setSchedEnabled(v => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                schedEnabled ? 'bg-accent' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  schedEnabled ? 'translate-x-4' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <label className="text-sm text-gray-700 flex-shrink-0" htmlFor="sched-time">Time</label>
            <input
              id="sched-time"
              type="time"
              value={schedTime}
              onChange={(e) => setSchedTime(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1 w-28"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <label className="text-sm text-gray-700 flex-shrink-0" htmlFor="sched-email">Send to</label>
            <input
              id="sched-email"
              type="email"
              value={schedEmail}
              onChange={(e) => setSchedEmail(e.target.value)}
              placeholder="email@example.com"
              className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 min-w-0"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={saveSchedule}
              disabled={schedSaving}
              className="text-xs bg-accent text-white px-3 py-1 rounded disabled:opacity-50 hover:bg-blue-700"
            >
              {schedSaving ? 'Saving…' : 'Save'}
            </button>
            {schedSaved && (
              <span className="text-xs text-green-600 font-medium">Saved ✓</span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      {loading && !digest && (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Generating brief with Claude…
        </div>
      )}

      {digest && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-xs text-blue-500 font-medium mb-1">
              {digest.date} · {digest.email_count} email{digest.email_count !== 1 ? 's' : ''}
            </p>
            <p className="text-sm text-gray-800 leading-relaxed">{digest.summary}</p>
          </div>

          {digest.highlights.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Highlights</h3>
              <ul className="space-y-1.5">
                {digest.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {digest.top_action_items.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Action Required</h3>
              <ul className="space-y-1.5">
                {digest.top_action_items.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="text-orange-400 mt-0.5 flex-shrink-0">!</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {digest.email_count === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No emails in this time window.</p>
          )}
        </>
      )}
    </div>
  )
}
