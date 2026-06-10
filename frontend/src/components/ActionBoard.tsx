import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { addToast } from './Toast'
import type { ActionItem, FollowUp, WaitingEmail } from '../types'
import { Spinner, EmptyState, Button, Badge } from './ui'
import { TaskExportButton } from './TaskExportButton'
import { DelegationTracker } from './DelegationTracker'
import { OvernightDrafts } from './OvernightDrafts'

function formatDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface SentCommitment {
  email_id: string
  subject: string
  date: string
  commitments: string[]
}

export function ActionBoard() {
  const [actions, setActions] = useState<ActionItem[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [showDone, setShowDone] = useState(false)
  const [tab, setTab] = useState<'actions' | 'followups' | 'waiting' | 'delegations' | 'overnight'>('actions')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [waiting, setWaiting] = useState<WaitingEmail[]>([])
  const [loadingWaiting, setLoadingWaiting] = useState(false)

  // Scan sent mail state
  const [scanningMail, setScanningMail] = useState(false)
  const [sentCommitments, setSentCommitments] = useState<SentCommitment[] | null>(null)
  const [scanError, setScanError] = useState('')
  const [addingItem, setAddingItem] = useState<string | null>(null)

  const loadWaiting = async () => {
    setLoadingWaiting(true)
    try { const r = await api.getWaitingReplies(); setWaiting(r.emails) }
    catch { /* ignore */ }
    finally { setLoadingWaiting(false) }
  }

  useEffect(() => { if (tab === 'waiting') loadWaiting() }, [tab])

  const reload = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [a, f] = await Promise.all([
        api.getActions(showDone ? undefined : false),
        api.getFollowUps(showDone ? undefined : false),
      ])
      setActions(a)
      setFollowUps(f)
    } catch (e) {
      setLoadError('Failed to load — check backend is running')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [showDone])

  const toggleAction = async (id: number, done: boolean) => {
    if (done && !showDone) {
      // Remove immediately from list; restore on failure
      const original = actions.find((a) => a.id === id)
      setActions((prev) => prev.filter((a) => a.id !== id))
      try {
        await api.setActionDone(id, done)
      } catch {
        if (original) setActions((prev) => [...prev, original].sort((a, b) => a.id - b.id))
      }
    } else {
      setActions((prev) => prev.map((a) => a.id === id ? { ...a, done } : a))
      try {
        await api.setActionDone(id, done)
      } catch {
        setActions((prev) => prev.map((a) => a.id === id ? { ...a, done: !done } : a))
      }
    }
  }

  const toggleFollowUp = async (id: number, done: boolean) => {
    await api.setFollowUpDone(id, done)
    reload()
  }

  const deleteFollowUp = async (id: number) => {
    await api.deleteFollowUp(id)
    setFollowUps((prev) => prev.filter((f) => f.id !== id))
  }

  const handleScanSent = async () => {
    setScanningMail(true)
    setScanError('')
    setSentCommitments(null)
    try {
      const result = await api.detectSentCommitments()
      setSentCommitments(result.detected)
      if (result.detected.length === 0 && result.scanned === 0) {
        setScanError('No recent sent emails found (last 14 days).')
      } else if (result.detected.length === 0) {
        setScanError(`Scanned ${result.scanned} sent email${result.scanned !== 1 ? 's' : ''} — no commitments detected.`)
      }
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanningMail(false)
    }
  }

  const handleAddCommitment = async (commitment: SentCommitment, text: string) => {
    const key = `${commitment.email_id}:${text}`
    setAddingItem(key)
    try {
      await api.addActionItem(commitment.email_id, commitment.subject, [text])
      // Remove this commitment from the list
      setSentCommitments((prev) =>
        prev
          ? prev.map((c) =>
              c.email_id === commitment.email_id
                ? { ...c, commitments: c.commitments.filter((t) => t !== text) }
                : c
            ).filter((c) => c.commitments.length > 0)
          : prev
      )
      reload()
    } catch { /* ignore */ }
    finally { setAddingItem(null) }
  }

  const pendingActions = actions.filter((a) => !a.done)
  const pendingFollowUps = followUps.filter((f) => !f.done)
  const overdueFollowUps = pendingFollowUps.filter((f) => f.due_date < new Date().toISOString().slice(0, 10))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-4 pt-4 gap-4">
        {(['actions', 'followups', 'waiting', 'delegations', 'overnight'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'actions'
              ? `Action Items${pendingActions.length ? ` (${pendingActions.length})` : ''}`
              : t === 'followups'
              ? `Follow-ups${overdueFollowUps.length ? ` ⚠ ${overdueFollowUps.length}` : pendingFollowUps.length ? ` (${pendingFollowUps.length})` : ''}`
              : t === 'waiting'
              ? `Waiting${waiting.length ? ` (${waiting.length})` : ''}`
              : t === 'delegations'
              ? 'Delegations'
              : 'Overnight'}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 pb-2">
          <a
            href="/api/actions/export.csv"
            download="action_items.csv"
            className="text-xs text-gray-400 hover:text-accent transition-colors flex items-center gap-1"
            title="Export as CSV"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            CSV
          </a>
          <button
            onClick={async () => {
              const items = actions.filter(a => !a.done)
              const text = items.map(a => `- [ ] ${a.text} (from: ${a.email_subject || 'unknown'})`).join('\n')
              await navigator.clipboard.writeText(text).catch(() => {})
              addToast('Action items copied to clipboard', 'success')
            }}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            Copy as list
          </button>
          <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show done
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && (
          <div className="flex justify-center py-12">
            <Spinner size="md" />
          </div>
        )}
        {!loading && loadError && (
          <p className="text-sm text-red-400 text-center py-12">{loadError}</p>
        )}
        {!loading && !loadError && tab === 'actions' && (
          <>
            {/* Scan sent mail button */}
            <div className="flex items-center gap-2 mb-1">
              <button
                onClick={handleScanSent}
                disabled={scanningMail}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
              >
                {scanningMail ? (
                  <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
                {scanningMail ? 'Scanning sent mail…' : 'Scan sent mail for commitments'}
              </button>
              {sentCommitments !== null && (
                <button
                  onClick={() => { setSentCommitments(null); setScanError('') }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Scan results panel */}
            {scanError && (
              <p className="text-xs text-gray-400 px-1 pb-1">{scanError}</p>
            )}
            {sentCommitments !== null && sentCommitments.length > 0 && (
              <div className="border border-blue-100 rounded-xl bg-blue-50 p-3 space-y-3 mb-2">
                <p className="text-xs font-semibold text-blue-700">
                  Found commitments in {sentCommitments.length} sent email{sentCommitments.length !== 1 ? 's' : ''}
                </p>
                {sentCommitments.map((c) => (
                  <div key={c.email_id} className="bg-white border border-blue-100 rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-gray-700 truncate flex-1">{c.subject}</p>
                      <span className="text-xs text-gray-400 shrink-0">{c.date}</span>
                    </div>
                    {c.commitments.map((text) => {
                      const key = `${c.email_id}:${text}`
                      return (
                        <div key={text} className="flex items-start gap-2 pl-1">
                          <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                          <p className="text-xs text-gray-600 flex-1">{text}</p>
                          <button
                            onClick={() => handleAddCommitment(c, text)}
                            disabled={addingItem === key}
                            className="shrink-0 text-xs px-2 py-0.5 bg-accent text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {addingItem === key ? '...' : 'Add'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            {actions.length === 0 && (
              <div className="py-8">
                <EmptyState
                  icon="✅"
                  title="No action items yet"
                  description="Select an email → AI Analysis → Save to action board"
                />
              </div>
            )}
            {actions.map((a) => (
              <div
                key={a.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  a.done ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={a.done}
                  onChange={(e) => toggleAction(a.id, e.target.checked)}
                  className="mt-0.5 accent-accent"
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${a.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {a.text}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{a.email_subject}</p>
                </div>
                {!a.done && (
                  <TaskExportButton actionId={a.id} text={a.text} emailSubject={a.email_subject} />
                )}
              </div>
            ))}
          </>
        )}

        {!loading && !loadError && tab === 'followups' && (
          <>
            {followUps.length === 0 && (
              <div className="py-8">
                <EmptyState
                  icon="📅"
                  title="No follow-ups scheduled"
                  description="Set one from the email viewer."
                />
              </div>
            )}
            {followUps.map((f) => {
              const overdue = !f.done && f.due_date < new Date().toISOString().slice(0, 10)
              return (
                <div
                  key={f.id}
                  className={`p-3 rounded-lg border ${
                    f.done
                      ? 'bg-gray-50 border-gray-100 opacity-60'
                      : overdue
                      ? 'bg-red-50 border-red-200'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={f.done}
                      onChange={(e) => toggleFollowUp(f.id, e.target.checked)}
                      className="mt-0.5 accent-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${f.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                        {f.subject || '(no subject)'}
                      </p>
                      <p className="text-xs text-gray-500">{f.sender}</p>
                      {f.note && <p className="text-xs text-gray-600 mt-0.5">{f.note}</p>}
                      <p className={`text-xs mt-1 font-medium ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                        {overdue ? 'Overdue · ' : 'Due · '}
                        {formatDate(f.due_date)}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteFollowUp(f.id)}
                      className="text-gray-300 hover:text-red-400 text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </>
        )}
      {/* Delegations */}
      {tab === 'delegations' && <DelegationTracker />}

      {/* Overnight Drafts */}
      {tab === 'overnight' && <OvernightDrafts />}

      {/* Waiting for reply */}
      {tab === 'waiting' && (
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 space-y-2">
          <p className="text-xs text-gray-400 mb-3">Sent emails with no reply in 3+ days</p>
          {loadingWaiting && <div className="flex justify-center py-8"><Spinner size="md" /></div>}
          {!loadingWaiting && waiting.length === 0 && (
            <div className="py-8">
              <EmptyState
                icon="✅"
                title="All caught up!"
                description="No sent emails are waiting for a reply."
              />
            </div>
          )}
          {waiting.map((em) => (
            <div key={em.id} className="border border-gray-200 rounded-xl px-4 py-3 bg-white hover:border-accent transition-colors">
              <p className="text-sm font-medium text-gray-800 truncate">{em.subject}</p>
              <p className="text-xs text-gray-400 mt-0.5">To: {em.recipient || 'unknown'}</p>
              <p className="text-xs text-gray-400">{em.date}</p>
              <span className={`mt-1 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                em.days_waiting >= 7 ? 'bg-red-100 text-red-700' :
                em.days_waiting >= 5 ? 'bg-orange-100 text-orange-700' :
                'bg-yellow-100 text-yellow-700'
              }`}>
                Waiting {em.days_waiting} day{em.days_waiting !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
          {!loadingWaiting && (
            <button onClick={loadWaiting} className="w-full text-xs text-gray-400 hover:text-accent py-2">Refresh</button>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
