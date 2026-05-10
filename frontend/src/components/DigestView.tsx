import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { DigestResponse } from '../types'

export function DigestView() {
  const [digest, setDigest] = useState<DigestResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hours, setHours] = useState(24)

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
            onClick={load}
            disabled={loading}
            className="text-xs bg-accent text-white px-3 py-1 rounded disabled:opacity-50 hover:bg-blue-700"
          >
            {loading ? 'Generating…' : 'Refresh'}
          </button>
        </div>
      </div>

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
