import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { OpenLoop } from '../../types'

const DISMISSED_KEY = 'dismissed_loops'

function loopFingerprint(l: OpenLoop): string {
  return `${l.type}|${l.sender}|${(l.date || '').slice(0, 10)}|${(l.text || '').slice(0, 60)}`
}

function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) }
  catch { return new Set() }
}

function saveDismissed(s: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]))
}

export function LoopsTab() {
  const [loops, setLoops] = useState<OpenLoop[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState<'all' | 'commitment' | 'awaiting' | 'deadline'>('all')
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)
  const [showDismissed, setShowDismissed] = useState(false)

  const load = () => {
    setLoading(true)
    api.getOpenLoops()
      .then(r => { setLoops(r.loops); setLoaded(true) })
      .catch(() => setLoops([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!loaded) return
    const id = setInterval(load, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [loaded])

  const dismiss = (loop: OpenLoop) => {
    const next = new Set(dismissed)
    next.add(loopFingerprint(loop))
    setDismissed(next)
    saveDismissed(next)
  }

  const restore = (loop: OpenLoop) => {
    const next = new Set(dismissed)
    next.delete(loopFingerprint(loop))
    setDismissed(next)
    saveDismissed(next)
  }

  const clearAllDismissed = () => {
    setDismissed(new Set())
    saveDismissed(new Set())
    setShowDismissed(false)
  }

  const active = loops.filter(l => !dismissed.has(loopFingerprint(l)))
  const dismissedLoops = loops.filter(l => dismissed.has(loopFingerprint(l)))

  const exportCSV = () => {
    const rows = [
      ['type', 'urgency', 'text', 'sender', 'date'],
      ...active.map(l => [l.type, l.urgency, `"${(l.text || '').replace(/"/g, '""')}"`, `"${(l.sender || '').replace(/"/g, '""')}"`, l.date || ''])
    ]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }))
    a.download = 'open_loops.csv'
    a.click()
  }

  const filtered = filter === 'all' ? active : active.filter(l => l.type === filter)
  const filteredDismissed = filter === 'all' ? dismissedLoops : dismissedLoops.filter(l => l.type === filter)
  const high = filtered.filter(l => l.urgency === 'high')
  const medium = filtered.filter(l => l.urgency === 'medium')
  const low = filtered.filter(l => l.urgency === 'low')

  const urgencyStyle = (u: string) =>
    u === 'high' ? 'border-red-200 bg-red-50' :
    u === 'medium' ? 'border-amber-200 bg-amber-50' :
    'border-gray-100 bg-white'

  const badgeStyle = (u: string) =>
    u === 'high' ? 'bg-red-100 text-red-700' :
    u === 'medium' ? 'bg-amber-100 text-amber-700' :
    'bg-gray-100 text-gray-500'

  const typeIcon = (t: string) => t === 'commitment' ? '📌' : t === 'awaiting' ? '⏳' : '⚡'

  if (!loaded && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
        <div className="text-4xl">🔄</div>
        <div className="text-center">
          <p className="text-sm text-gray-600 font-medium">Scan for open commitments</p>
          <p className="text-xs text-gray-400 mt-1">AI will scan your recent emails for unresolved items, awaited responses, and deadlines.</p>
        </div>
        <button onClick={load} className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-blue-700 transition-colors">
          Scan emails
        </button>
      </div>
    )
  }

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
        <div className="flex gap-1 flex-wrap">
          {(['all', 'commitment', 'awaiting', 'deadline'] as const).map(f => {
            const activeCount = f === 'all' ? active.length : active.filter(l => l.type === f).length
            const dismissedCount = f === 'all' ? dismissedLoops.length : dismissedLoops.filter(l => l.type === f).length
            const total = showDismissed ? activeCount + dismissedCount : activeCount
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === f ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                {f === 'all' ? `All (${total})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${total})`}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1">
          {dismissedLoops.length > 0 && (
            <button onClick={() => setShowDismissed(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">
              {showDismissed ? 'Hide' : `Dismissed (${dismissedLoops.length})`}
            </button>
          )}
          {active.length > 0 && (
            <button onClick={exportCSV} title="Export to CSV"
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">CSV</button>
          )}
          <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">Refresh</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {filtered.length === 0 && filteredDismissed.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No open items found</p>
        )}
        {filtered.length === 0 && filteredDismissed.length > 0 && !showDismissed && (
          <p className="text-sm text-gray-400 text-center py-8">
            All items are resolved — click <span className="font-medium">Dismissed ({filteredDismissed.length})</span> to view
          </p>
        )}
        {[...high, ...medium, ...low].map((loop, i) => (
          <div key={i} className={`border rounded-xl p-3 ${urgencyStyle(loop.urgency)}`}>
            <div className="flex items-start gap-2">
              <span className="text-base flex-shrink-0 mt-0.5">{typeIcon(loop.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{loop.text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-500 truncate">{loop.sender}</span>
                  <span className="text-xs text-gray-400">{loop.date?.slice(0, 10)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeStyle(loop.urgency)}`}>{loop.urgency}</span>
                  <span className="text-[10px] text-gray-400">{loop.type}</span>
                </div>
              </div>
              <button
                onClick={() => dismiss(loop)}
                title="Mark as resolved"
                className="flex-shrink-0 text-gray-300 hover:text-green-500 transition-colors p-1 rounded hover:bg-white/60"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
              </button>
            </div>
          </div>
        ))}

        {showDismissed && filteredDismissed.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Resolved / Dismissed ({filteredDismissed.length})
              </p>
              <button onClick={clearAllDismissed} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Clear all</button>
            </div>
            {filteredDismissed.map((loop, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 bg-gray-50 opacity-60 mb-2">
                <div className="flex items-start gap-2">
                  <span className="text-base flex-shrink-0 mt-0.5 grayscale">{typeIcon(loop.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-500 line-through">{loop.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400 truncate">{loop.sender}</span>
                      <span className="text-xs text-gray-300">{loop.date?.slice(0, 10)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => restore(loop)}
                    title="Restore"
                    className="flex-shrink-0 text-gray-300 hover:text-accent transition-colors p-1 rounded hover:bg-white"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clipRule="evenodd"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
