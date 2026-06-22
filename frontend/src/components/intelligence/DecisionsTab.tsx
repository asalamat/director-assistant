import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Decision } from '../../types'

const THRESHOLDS = [14, 30, 60]

export function DecisionsTab() {
  const [days, setDays] = useState(30)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [brief, setBrief] = useState<{ subject: string; text: string } | null>(null)
  const [briefing, setBriefing] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    api.getDecisions(days)
      .then(r => { if (!cancelled) setDecisions(r.decisions) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load decisions') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const dismiss = (id: string) =>
    setDecisions(prev => prev.filter(d => d.id !== id))

  const generateBrief = async (d: Decision) => {
    setBriefing(d.id); setBrief(null)
    try {
      const r = await api.getDecisionBrief(d.id)
      setBrief({ subject: r.subject, text: r.brief })
    } catch (e) {
      setBrief({ subject: d.subject, text: (e as Error).message || 'Failed to generate brief' })
    } finally {
      setBriefing('')
    }
  }

  const ageColor = (n: number) =>
    n >= 7 ? 'text-red-600 bg-red-50' : n >= 3 ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-50'

  const mine = decisions.filter(d => d.direction === 'mine')
  const theirs = decisions.filter(d => d.direction === 'theirs')

  const Card = ({ d }: { d: Decision }) => (
    <div className="border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{d.subject}</p>
          <p className="text-xs text-gray-400 truncate">{d.sender}</p>
        </div>
        <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${ageColor(d.days_waiting)}`}>
          {d.days_waiting === 0 ? 'today' : `${d.days_waiting}d waiting`}
        </span>
      </div>
      {d.snippet && (
        <p className="text-xs italic text-gray-500 line-clamp-2">{d.snippet.slice(0, 100)}</p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => generateBrief(d)}
          disabled={briefing === d.id}
          className="px-3 py-1 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90 disabled:opacity-50 transition"
        >
          {briefing === d.id ? 'Generating…' : 'Generate Brief'}
        </button>
        <button
          onClick={() => dismiss(d.id)}
          className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
        >
          Dismiss
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Decision Tracker</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {mine.length} need your decision · {theirs.length} waiting on others
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Last:</span>
        {THRESHOLDS.map(t => (
          <button
            key={t}
            onClick={() => setDays(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              days === t ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t}d
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-accent rounded-full animate-spin" />
          Loading…
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!loading && !error && decisions.length === 0 && (
        <p className="text-sm text-gray-400">✅ No pending decisions found</p>
      )}

      {!loading && mine.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Needs My Decision</h3>
          {mine.map(d => <Card key={d.id} d={d} />)}
        </section>
      )}

      {!loading && theirs.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Waiting on Others</h3>
          {theirs.map(d => <Card key={d.id} d={d} />)}
        </section>
      )}

      {brief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBrief(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900">Decision Brief</h3>
            <p className="text-xs text-gray-400 truncate">{brief.subject}</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{brief.text}</p>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setBrief(null)}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
