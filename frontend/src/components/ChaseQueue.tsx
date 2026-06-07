import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { EmptyState, Spinner, Button } from './ui'

interface WaitingEmail {
  id: string; subject: string; sender: string; recipient: string
  date: string; days_waiting: number
}

interface Draft {
  emailId: string; draft: string; subject: string; to: string
}

const DISMISSED_KEY = 'chase_dismissed'

function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) }
  catch { return new Set() }
}
function saveDismissed(s: Set<string>) {
  // Keep at most 500 dismissed IDs so localStorage doesn't grow unbounded
  const arr = Array.from(s).slice(-500)
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr))
}

export function ChaseQueue({ onOpenCompose }: { onOpenCompose?: (opts: { to: string; subject: string; body: string }) => void }) {
  const [emails, setEmails] = useState<WaitingEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(3)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [generating, setGenerating] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)
  const [showDismissed, setShowDismissed] = useState(false)

  const load = () => {
    setLoading(true)
    api.getWaitingReplies(days).then(r => setEmails(r.emails || [])).catch(() => setEmails([])).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [days])

  const dismiss = (id: string) => {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    saveDismissed(next)
    setDrafts(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  const restore = (id: string) => {
    const next = new Set(dismissed)
    next.delete(id)
    setDismissed(next)
    saveDismissed(next)
  }

  const clearAllDismissed = () => {
    setDismissed(new Set())
    saveDismissed(new Set())
    setShowDismissed(false)
  }

  const generateDraft = async (email: WaitingEmail) => {
    setGenerating(email.id)
    try {
      const r = await api.generateChaseDraft(email.id)
      setDrafts(prev => ({ ...prev, [email.id]: { emailId: email.id, draft: r.draft, subject: r.subject, to: r.to } }))
    } catch { /* silent */ }
    setGenerating(null)
  }

  const urgencyColor = (d: number) =>
    d >= 14 ? 'border-red-200 bg-red-50' :
    d >= 7  ? 'border-amber-200 bg-amber-50' :
    'border-gray-100 bg-white'

  const urgencyBadge = (d: number) =>
    d >= 14 ? 'bg-red-100 text-red-700' :
    d >= 7  ? 'bg-amber-100 text-amber-700' :
    'bg-gray-100 text-gray-500'

  const active = emails.filter(e => !dismissed.has(e.id))
  const dismissedEmails = emails.filter(e => dismissed.has(e.id))

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Chase Queue</h2>
          <p className="text-xs text-gray-400 mt-0.5">{active.length} email{active.length !== 1 ? 's' : ''} waiting for a reply</p>
        </div>
        <div className="flex items-center gap-2">
          {dismissedEmails.length > 0 && (
            <button onClick={() => setShowDismissed(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
              {showDismissed ? 'Hide dismissed' : `Dismissed (${dismissedEmails.length})`}
            </button>
          )}
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white">
            <option value={2}>2+ days</option>
            <option value={3}>3+ days</option>
            <option value={7}>7+ days</option>
            <option value={14}>14+ days</option>
          </select>
          <button onClick={load} className="text-xs text-gray-400 hover:text-accent px-2 py-1 rounded hover:bg-blue-50 transition-colors" title="Refresh">↺</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading && <div className="flex justify-center py-12"><Spinner size="md" /></div>}

        {!loading && active.length === 0 && !showDismissed && (
          <div className="py-8">
            <EmptyState
              icon="✅"
              title="All caught up!"
              description={`No sent emails waiting for a reply in ${days}+ days.${dismissedEmails.length > 0 ? ` (${dismissedEmails.length} dismissed)` : ''}`}
            />
          </div>
        )}

        {/* Active emails */}
        {active.map(email => (
          <div key={email.id} className={`border rounded-xl p-3 ${urgencyColor(email.days_waiting)}`}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-sm font-medium text-gray-800 flex-1">{email.subject || '(no subject)'}</p>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${urgencyBadge(email.days_waiting)}`}>
                  {email.days_waiting}d waiting
                </span>
                <button
                  onClick={() => dismiss(email.id)}
                  title="No follow-up needed — dismiss"
                  className="text-gray-300 hover:text-gray-500 hover:bg-white/60 rounded p-0.5 transition-colors text-xs leading-none"
                >
                  ✕
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2">To: {email.recipient || email.sender}</p>

            {drafts[email.id] ? (
              <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-gray-600">Follow-up draft:</p>
                <p className="text-xs text-gray-700 whitespace-pre-wrap">{drafts[email.id].draft}</p>
                <div className="flex gap-2 pt-1 flex-wrap">
                  {onOpenCompose && (
                    <button
                      onClick={() => onOpenCompose({ to: drafts[email.id].to, subject: drafts[email.id].subject, body: drafts[email.id].draft })}
                      className="text-xs bg-accent text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 transition-colors">
                      Open in Compose
                    </button>
                  )}
                  <button onClick={() => navigator.clipboard.writeText(drafts[email.id].draft).catch(() => {})}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2.5 py-1 rounded border border-gray-200 hover:border-gray-300 transition-colors">
                    Copy
                  </button>
                  <button onClick={() => dismiss(email.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 ml-auto">No follow-up needed</button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                loading={generating === email.id}
                onClick={() => generateDraft(email)}
                disabled={generating === email.id}
              >
                {generating === email.id ? 'Drafting…' : '✎ Write follow-up'}
              </Button>
            )}
          </div>
        ))}

        {/* Dismissed section */}
        {showDismissed && dismissedEmails.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                No follow-up needed ({dismissedEmails.length})
              </p>
              <button onClick={clearAllDismissed}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                Clear all
              </button>
            </div>
            {dismissedEmails.map(email => (
              <div key={email.id} className="border border-gray-100 rounded-xl p-3 bg-gray-50 opacity-60 mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-500 line-through truncate">{email.subject || '(no subject)'}</p>
                  <p className="text-xs text-gray-400">To: {email.recipient || email.sender}</p>
                </div>
                <button onClick={() => restore(email.id)}
                  title="Restore to queue"
                  className="text-xs text-gray-400 hover:text-accent flex-shrink-0 px-2 py-1 rounded hover:bg-blue-50 transition-colors">
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
