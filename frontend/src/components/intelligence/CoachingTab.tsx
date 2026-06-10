import { useState } from 'react'
import { api } from '../../api/client'

export function CoachingTab() {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const analyze = async () => {
    setLoading(true); setError(''); setData(null)
    try { const r = await api.getEmailCoaching(); setData(r) }
    catch (e: any) { setError(e.message || 'Failed') }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Email Coaching</h2>
        <p className="text-xs text-gray-500 mt-0.5">AI analysis of your last 30 days of sent emails with personalized tips.</p>
      </div>
      <button onClick={analyze} disabled={loading}
        className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium w-fit">
        {loading ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"/>Analyzing…</> : '🎯 Analyze my emails'}
      </button>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {data && (
        <>
          {data.stats && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Emails analyzed', val: data.stats.emails_analyzed },
                { label: 'Avg email length', val: `${data.stats.avg_length} chars` },
                { label: 'Reply ratio', val: `${data.stats.reply_ratio}%` },
              ].map(s => (
                <div key={s.label} className="border border-gray-200 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-800">{s.val}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}
          {data.strengths?.length > 0 && (
            <div className="border border-green-200 bg-green-50/40 rounded-xl p-4">
              <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">Strengths</p>
              {data.strengths.map((s: string, i: number) => (
                <p key={i} className="text-sm text-green-800 flex gap-2"><span>✓</span>{s}</p>
              ))}
            </div>
          )}
          {data.tips?.length > 0 && (
            <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-2">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">Coaching Tips</p>
              {data.tips.map((t: string, i: number) => (
                <div key={i} className="flex gap-2 text-sm text-amber-800">
                  <span className="flex-shrink-0 font-bold">{i+1}.</span>
                  <p>{t}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
