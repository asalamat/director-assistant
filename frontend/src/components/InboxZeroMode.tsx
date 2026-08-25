import { useState, useEffect, useCallback } from 'react'
import type { EmailBrief } from '../types'
import { api } from '../api/client'

type GroupKey = 'reply_needed' | 'fyi' | 'review' | 'junk'
const GROUP_LABELS: Record<GroupKey, string> = {
  reply_needed: 'Reply Needed',
  fyi: 'FYI',
  review: 'Review',
  junk: 'Junk',
}

interface Props {
  onClose: () => void
}

export function InboxZeroMode({ onClose }: Props) {
  const [groups, setGroups] = useState<Record<GroupKey, EmailBrief[]>>({
    reply_needed: [], fyi: [], review: [], junk: [],
  })
  const [total, setTotal] = useState(0)
  const [processed, setProcessed] = useState(0)
  const [activeGroup, setActiveGroup] = useState<GroupKey>('reply_needed')
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  useEffect(() => {
    api.batchTriage().then(r => {
      setGroups(r.groups)
      setTotal(r.total)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const currentGroup = groups[activeGroup]
  const currentEmail = currentGroup[activeIndex] ?? null

  const flashMsg = (msg: string) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(null), 1500)
  }

  const advanceOrSwitchGroup = useCallback((removedGroup: GroupKey, removedIdx: number) => {
    setGroups(prev => {
      const updated = { ...prev, [removedGroup]: prev[removedGroup].filter((_, i) => i !== removedIdx) }
      return updated
    })
    setProcessed(p => p + 1)
    setActiveIndex(prev => Math.max(0, prev - 1))
  }, [])

  const handleAction = useCallback(async (action: string) => {
    if (!currentEmail) return
    const grp = activeGroup
    const idx = activeIndex
    try {
      if (action === 'archive') {
        await api.bulkEmailAction('archive', [currentEmail.id])
        flashMsg('Archived')
      } else if (action === 'snooze') {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        await api.snoozeEmail(currentEmail.id, tomorrow.toISOString().slice(0, 10))
        flashMsg('Snoozed until tomorrow')
      } else if (action === 'chase') {
        await api.createFollowUp({ email_id: currentEmail.id, subject: currentEmail.subject, sender: currentEmail.sender, due_date: '', note: '' })
        flashMsg('Added to chase queue')
      } else if (action === 'delete') {
        await api.deleteEmail(currentEmail.id)
        flashMsg('Deleted')
      } else if (action === 'reply') {
        flashMsg('Open reply in inbox')
        onClose()
        return
      }
      advanceOrSwitchGroup(grp, idx)
    } catch {
      flashMsg('Action failed')
    }
  }, [currentEmail, activeGroup, activeIndex, advanceOrSwitchGroup, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'r' || e.key === 'R') handleAction('reply')
      if (e.key === 'a' || e.key === 'A') handleAction('archive')
      if (e.key === 's' || e.key === 'S') handleAction('snooze')
      if (e.key === 'c' || e.key === 'C') handleAction('chase')
      if (e.key === 'd' || e.key === 'D') handleAction('delete')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleAction, onClose])

  const groupKeys = Object.keys(GROUP_LABELS) as GroupKey[]

  return (
    <div className="fixed inset-0 bg-gray-950/95 z-50 flex flex-col items-center justify-center">
      <div className="w-full max-w-2xl flex flex-col gap-4 px-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-white text-lg font-bold">Inbox Zero Mode</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm px-3 py-1 rounded-lg hover:bg-gray-800 transition-colors">
            Esc — Close
          </button>
        </div>

        {/* Progress */}
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{processed} of {total} processed</span>
            <span>{total - processed} remaining</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-accent-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: total > 0 ? `${(processed / total) * 100}%` : '0%' }}
            />
          </div>
        </div>

        {/* Group tabs */}
        <div className="flex gap-2">
          {groupKeys.map(g => (
            <button
              key={g}
              onClick={() => { setActiveGroup(g); setActiveIndex(0) }}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeGroup === g
                  ? 'bg-accent-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {GROUP_LABELS[g]}
              {groups[g].length > 0 && (
                <span className="ml-1.5 bg-white/20 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                  {groups[g].length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Email card */}
        {loading ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center text-gray-400 text-sm">Loading emails…</div>
        ) : currentEmail ? (
          <div className="bg-gray-900 rounded-2xl p-6 space-y-3 min-h-[200px]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-white font-semibold text-base truncate">{currentEmail.subject || '(no subject)'}</p>
                <p className="text-gray-400 text-sm mt-0.5">{currentEmail.sender}</p>
              </div>
              {currentEmail.date && (
                <span className="text-gray-500 text-xs flex-shrink-0">{new Date(currentEmail.date).toLocaleDateString()}</span>
              )}
            </div>
            <p className="text-gray-300 text-sm leading-relaxed line-clamp-4">{currentEmail.preview}</p>
            {actionMsg && (
              <p className="text-green-400 text-sm font-medium">{actionMsg}</p>
            )}
            <div className="text-xs text-gray-500">
              {activeIndex + 1} of {currentGroup.length} in {GROUP_LABELS[activeGroup]}
            </div>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-2xl p-8 text-center text-gray-400 text-sm">
            {groups[activeGroup].length === 0 ? `No emails in ${GROUP_LABELS[activeGroup]}` : 'All done!'}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {[
            { key: 'reply', label: 'R — Reply', cls: 'bg-blue-600 hover:bg-blue-500' },
            { key: 'archive', label: 'A — Archive', cls: 'bg-gray-700 hover:bg-gray-600' },
            { key: 'snooze', label: 'S — Snooze', cls: 'bg-yellow-600 hover:bg-yellow-500' },
            { key: 'chase', label: 'C — Chase', cls: 'bg-purple-700 hover:bg-purple-600' },
            { key: 'delete', label: 'D — Delete', cls: 'bg-red-700 hover:bg-red-600' },
          ].map(({ key, label, cls }) => (
            <button
              key={key}
              onClick={() => handleAction(key)}
              disabled={!currentEmail}
              className={`text-sm font-medium text-white px-4 py-2 rounded-xl transition-colors disabled:opacity-40 ${cls}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Legend */}
        <p className="text-xs text-gray-600 text-center">
          Keyboard: R reply · A archive · S snooze · C chase · D delete · Esc close
        </p>
      </div>
    </div>
  )
}
