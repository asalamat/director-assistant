import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { TriageEmail } from '../types'
import { useEmailContext } from '../contexts/EmailContext'
import { useUIContext } from '../contexts/UIContext'

const REASON_COLORS: Record<string, string> = {
  'urgent subject':    'bg-red-100 text-red-700',
  'urgent content':    'bg-orange-100 text-orange-700',
  'open action item':  'bg-purple-100 text-purple-700',
  'frequent contact':  'bg-blue-100 text-blue-700',
  'received today':    'bg-green-100 text-green-700',
  'received yesterday':'bg-teal-100 text-teal-700',
  'question asked':    'bg-yellow-100 text-yellow-700',
}

const SNOOZE_KEY = 'triage_snoozed'

function loadSnoozed(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveSnoozed(data: Record<string, string>) {
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(data))
}

function ScoreBadge({ score, reasons }: { score: number; reasons: string[] }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const color =
    score >= 6 ? 'bg-red-500 text-white' :
    score >= 4 ? 'bg-orange-400 text-white' :
    'bg-yellow-400 text-gray-800'
  const handleEnter = () => {
    if (!reasons.length) return
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, y: r.bottom + 6 })
  }
  return (
    <span ref={ref} className="relative flex-shrink-0"
      onMouseEnter={handleEnter} onMouseLeave={() => setPos(null)}>
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-help ${color}`}>
        {score}
      </span>
      {pos && reasons.length > 0 && (
        <div className="fixed z-[9999] bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl min-w-[180px] pointer-events-none"
          style={{ left: Math.min(pos.x, window.innerWidth - 210), top: pos.y }}>
          <p className="font-semibold mb-1 text-gray-200">Priority score: {score}</p>
          <ul className="space-y-0.5">
            {reasons.map(r => (
              <li key={r} className="flex items-center gap-1.5 text-gray-300">
                <span className="text-green-400">✓</span>{r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}

type LearnedPatterns = {
  low_priority_senders: string[]
  high_priority_senders: string[]
  low_priority_keywords: string[]
}

export function TriagePanel() {
  const { emails: contextEmails, selectEmail, fetchEmail } = useEmailContext()
  const { setActiveTab } = useUIContext()
  const handleEmailSelect = (id: string) => {
    const em = contextEmails.find(e => e.id === id)
    if (em) { selectEmail(em); setActiveTab('inbox') }
    else { fetchEmail(id); setActiveTab('inbox') }
  }
  const [emails, setEmails] = useState<TriageEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [snoozed, setSnoozed] = useState<Record<string, string>>(loadSnoozed)
  const [noted, setNoted] = useState<Record<string, boolean>>({})
  const [patterns, setPatterns] = useState<LearnedPatterns | null>(null)
  const [patternsOpen, setPatternsOpen] = useState(false)

  const loadPatterns = useCallback(async () => {
    try {
      setPatterns(await api.getTriagePatterns())
    } catch {
      // ignore
    }
  }, [])

  const sendFeedback = useCallback(
    async (em: TriageEmail, action: 'boost' | 'dismiss') => {
      setNoted(prev => ({ ...prev, [em.id]: true }))
      setTimeout(() => {
        setNoted(prev => { const n = { ...prev }; delete n[em.id]; return n })
      }, 1500)
      try {
        await api.triageFeedback(em.id, em.sender, em.subject, em.score, action)
        loadPatterns()
      } catch {
        // ignore
      }
    },
    [loadPatterns],
  )

  const resetLearning = useCallback(async () => {
    try {
      await api.resetTriageLearning()
      setPatterns({ low_priority_senders: [], high_priority_senders: [], low_priority_keywords: [] })
    } catch {
      // ignore
    }
  }, [])

  const isSnoozed = useCallback((id: string): boolean => {
    const until = snoozed[id]
    return !!until && until > new Date().toISOString()
  }, [snoozed])

  function snooze(id: string, hours: number) {
    const until = new Date(Date.now() + hours * 3600000).toISOString()
    setSnoozed(prev => { const n = { ...prev, [id]: until }; saveSnoozed(n); return n })
  }

  function clearAllSnoozed() {
    setSnoozed({})
    saveSnoozed({})
  }

  const snoozedCount = emails.filter(em => isSnoozed(em.id)).length

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { emails: list } = await api.getTriageTop(7)
      setEmails(list)
      setLastRefresh(new Date())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    loadPatterns()
    const id = setInterval(load, 5 * 60 * 1000) // refresh every 5 min
    return () => clearInterval(id)
  }, [load, loadPatterns])

  const lowCount = patterns?.low_priority_senders.length ?? 0
  const highCount = patterns?.high_priority_senders.length ?? 0
  const hasLearning = lowCount + highCount + (patterns?.low_priority_keywords.length ?? 0) > 0

  const visibleEmails = emails.filter(em => !isSnoozed(em.id))

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Today's Focus</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Top priority emails based on urgency, recency, and action items
          </p>
        </div>
        <div className="flex items-center gap-2">
          {snoozedCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              {snoozedCount} snoozed
              <button
                onClick={clearAllSnoozed}
                className="ml-0.5 hover:text-amber-800 font-bold leading-none"
                title="Clear all snoozed"
              >
                ×
              </button>
            </span>
          )}
          {lastRefresh && (
            <span className="text-xs text-gray-400">
              {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="text-xs text-gray-400 hover:text-accent p-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Learned patterns — collapsible */}
      <div className="mb-4 bg-indigo-50/60 border border-indigo-100 rounded-lg">
        <button
          onClick={() => setPatternsOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 text-left"
        >
          <span className="text-xs text-indigo-700">
            🧠 {hasLearning
              ? `${lowCount} sender${lowCount === 1 ? '' : 's'} learned as low priority · ${highCount} as high priority`
              : 'Learning from your 👍 / 👎 feedback'}
          </span>
          <svg className={`w-3.5 h-3.5 text-indigo-400 transition-transform ${patternsOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        {patternsOpen && (
          <div className="px-3 pb-3 pt-1 space-y-2 text-[11px]">
            {lowCount > 0 && (
              <div>
                <span className="text-gray-500">Low priority: </span>
                <span className="text-gray-700">{patterns!.low_priority_senders.join(', ')}</span>
              </div>
            )}
            {highCount > 0 && (
              <div>
                <span className="text-gray-500">High priority: </span>
                <span className="text-gray-700">{patterns!.high_priority_senders.join(', ')}</span>
              </div>
            )}
            {(patterns?.low_priority_keywords.length ?? 0) > 0 && (
              <div>
                <span className="text-gray-500">Ignored keywords: </span>
                <span className="text-gray-700">{patterns!.low_priority_keywords.join(', ')}</span>
              </div>
            )}
            {!hasLearning && (
              <p className="text-gray-400">
                Use 👍 to boost or 👎 to dismiss emails. After a sender is dismissed a few times,
                its emails are automatically deprioritized.
              </p>
            )}
            {hasLearning && (
              <button
                onClick={resetLearning}
                className="text-[11px] text-red-500 hover:text-red-700 hover:underline"
              >
                Reset Learning
              </button>
            )}
          </div>
        )}
      </div>

      {loading && emails.length === 0 && (
        <div className="flex items-center justify-center h-40">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && visibleEmails.length === 0 && (
        <div className="text-center py-16">
          <div className="text-3xl mb-3">🎉</div>
          <p className="text-sm font-medium text-gray-700">
            {emails.length > 0 && snoozedCount === emails.length
              ? 'All emails snoozed!'
              : 'Inbox zero! No urgent emails.'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {emails.length > 0 && snoozedCount === emails.length
              ? `${snoozedCount} email${snoozedCount > 1 ? 's' : ''} snoozed.`
              : 'No emails found in the last 14 days.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {visibleEmails.map((em, i) => (
          <div
            key={em.id}
            className="w-full text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-accent hover:shadow-sm transition-all group relative"
          >
            <div className="flex items-start gap-3">
              <span className="text-xs text-gray-400 font-mono w-4 mt-0.5 flex-shrink-0">{i + 1}</span>
              <button
                onClick={() => handleEmailSelect(em.id)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="flex items-center gap-2 mb-1">
                  <ScoreBadge score={em.score} reasons={em.reasons} />
                  <span className="text-sm font-medium text-gray-900 truncate group-hover:text-accent">
                    {em.subject}
                  </span>
                </div>
                <p className="text-xs text-gray-500 truncate mb-2">
                  {em.sender} · {em.date}
                </p>
                {em.preview && (
                  <p className="text-xs text-gray-400 line-clamp-1 mb-2">{em.preview}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {em.reasons.map((r) => (
                    <span
                      key={r}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        REASON_COLORS[r] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </button>

              <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-1">
                {/* Feedback buttons */}
                <div className="flex items-center gap-1">
                  {noted[em.id] ? (
                    <span className="text-[10px] text-green-600 font-medium whitespace-nowrap animate-pulse">
                      Noted ✓
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); sendFeedback(em, 'boost') }}
                        title="Important — surface more like this"
                        className="text-sm px-1 rounded hover:bg-green-50 transition-colors"
                      >
                        👍
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); sendFeedback(em, 'dismiss') }}
                        title="Not important — stop surfacing this"
                        className="text-sm px-1 rounded hover:bg-red-50 transition-colors"
                      >
                        👎
                      </button>
                    </>
                  )}
                </div>
                {/* Snooze buttons — visible on hover */}
                <div className="hidden group-hover:flex flex-col items-end gap-1">
                  <span className="text-[10px] text-gray-400 mb-0.5">snooze</span>
                  {([['2h', 2], ['Tomorrow', 24], ['3 days', 72]] as [string, number][]).map(([label, hours]) => (
                    <button
                      key={label}
                      onClick={(e) => { e.stopPropagation(); snooze(em.id, hours) }}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 transition-colors whitespace-nowrap"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {visibleEmails.length > 0 && (
        <p className="text-xs text-gray-400 text-center mt-6">
          Showing {visibleEmails.length} highest-priority emails from the last 14 days.
          Scores are based on urgency keywords, action items, sender frequency, and recency.
        </p>
      )}
    </div>
  )
}
