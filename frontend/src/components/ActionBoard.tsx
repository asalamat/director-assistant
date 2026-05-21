import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { ActionItem, FollowUp } from '../types'

function formatDate(s: string) {
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ActionBoard() {
  const [actions, setActions] = useState<ActionItem[]>([])
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [showDone, setShowDone] = useState(false)
  const [tab, setTab] = useState<'actions' | 'followups'>('actions')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

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
    await api.setActionDone(id, done)
    setActions((prev) => prev.map((a) => a.id === id ? { ...a, done } : a))
  }

  const toggleFollowUp = async (id: number, done: boolean) => {
    await api.setFollowUpDone(id, done)
    reload()
  }

  const deleteFollowUp = async (id: number) => {
    await api.deleteFollowUp(id)
    setFollowUps((prev) => prev.filter((f) => f.id !== id))
  }

  const pendingActions = actions.filter((a) => !a.done)
  const pendingFollowUps = followUps.filter((f) => !f.done)
  const overdueFollowUps = pendingFollowUps.filter((f) => f.due_date < new Date().toISOString().slice(0, 10))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 px-4 pt-4 gap-4">
        {(['actions', 'followups'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'actions'
              ? `Action Items${pendingActions.length ? ` (${pendingActions.length})` : ''}`
              : `Follow-ups${overdueFollowUps.length ? ` ⚠ ${overdueFollowUps.length}` : pendingFollowUps.length ? ` (${pendingFollowUps.length})` : ''}`}
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
          <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show done
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && loadError && (
          <p className="text-sm text-red-400 text-center py-12">{loadError}</p>
        )}
        {!loading && !loadError && tab === 'actions' && (
          <>
            {actions.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-12">
                No action items yet.<br />
                <span className="text-xs">Select an email → AI Analysis → Save to action board</span>
              </p>
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
              </div>
            ))}
          </>
        )}

        {!loading && !loadError && tab === 'followups' && (
          <>
            {followUps.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-12">
                No follow-ups scheduled. Set one from the email viewer.
              </p>
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
      </div>
    </div>
  )
}
