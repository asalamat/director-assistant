import { useState, useEffect } from 'react'
import { api } from '../api/client'

export function OvernightDrafts() {
  const [drafts, setDrafts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [running, setRunning] = useState(false)

  const load = () => {
    setLoading(true)
    api.getOvernightDrafts().then(r => setDrafts(r.drafts)).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const approve = async (id: number) => {
    setProcessing(id)
    try {
      await api.approveOvernightDraft(id)
      setDrafts(prev => prev.filter(d => d.id !== id))
      setMsg('Sent')
    } catch (e: any) { setMsg(`Failed: ${e.message}`) }
    setProcessing(null)
    setTimeout(() => setMsg(''), 3000)
  }

  const discard = async (id: number) => {
    setProcessing(id)
    await api.discardOvernightDraft(id).catch(() => {})
    setDrafts(prev => prev.filter(d => d.id !== id))
    setProcessing(null)
  }

  const runNow = async () => {
    setRunning(true)
    await api.runOvernightTriageNow().catch(() => {})
    setMsg('Running — drafts will appear in 1-2 minutes')
    setRunning(false)
    setTimeout(() => { setMsg(''); load() }, 90000)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-gray-800">Overnight Drafts</h2>
          <p className="text-xs text-gray-400">{drafts.length} AI-generated draft{drafts.length !== 1 ? 's' : ''} awaiting your approval</p>
        </div>
        <button onClick={runNow} disabled={running}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {running ? '...' : 'Run now'}
        </button>
        <button onClick={load} className="text-xs text-gray-400 hover:text-accent">Refresh</button>
      </div>
      {msg && <p className="px-4 text-xs text-green-600 flex-shrink-0">{msg}</p>}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>}
        {!loading && drafts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-3xl mb-2">💤</p>
            <p className="text-sm text-gray-500">No overnight drafts yet</p>
            <p className="text-xs text-gray-400 mt-1">Enable overnight triage in Settings and set a run time, or click Run now to generate drafts immediately.</p>
          </div>
        )}
        {drafts.map(d => (
          <div key={d.id} className="border border-blue-200 bg-blue-50/30 rounded-xl p-3 space-y-2">
            <div>
              <p className="text-sm font-medium text-gray-800 truncate">{d.email_subject}</p>
              <p className="text-xs text-gray-500">From: {d.email_sender} · To: {d.draft_to}</p>
            </div>
            <p className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-2.5 whitespace-pre-wrap leading-relaxed">{d.draft_body}</p>
            <div className="flex gap-2">
              <button onClick={() => approve(d.id)} disabled={processing === d.id}
                className="text-xs bg-accent text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {processing === d.id ? '...' : 'Send'}
              </button>
              <button onClick={() => discard(d.id)} disabled={processing === d.id}
                className="text-xs border border-gray-200 rounded-lg px-3 py-1 hover:bg-gray-50 disabled:opacity-50 transition-colors text-gray-500">
                Discard
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
