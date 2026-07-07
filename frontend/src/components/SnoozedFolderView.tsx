import { useState, useEffect, useCallback } from 'react'
import type { SnoozeEntry } from '../types'
import { api } from '../api/client'
import { Spinner } from './ui'

interface Props {
  mode: 'snoozed' | 'set-aside'
  onOpen: (emailId: string) => void
  onClose: () => void
}

function fmtWake(d?: string | null): string {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function SnoozedFolderView({ mode, onOpen, onClose }: Props) {
  const [entries, setEntries] = useState<SnoozeEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = mode === 'snoozed' ? await api.listSnoozed() : await api.listSetAside()
      setEntries('snoozed' in res ? res.snoozed : res.emails)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => { load() }, [load])

  const handleUnsnooze = async (emailId: string) => {
    await api.unsnoozeEmail(emailId).catch(() => {})
    setEntries(prev => prev.filter(e => e.email_id !== emailId))
  }

  const title = mode === 'snoozed' ? 'Snoozed' : 'Set Aside'
  const restoreLabel = mode === 'snoozed' ? 'Wake now' : 'Return to inbox'

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-700">{title} <span className="text-gray-400 font-normal">({entries.length})</span></span>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800">← Back to inbox</button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-10"><Spinner /></div>
      ) : entries.length === 0 ? (
        <div className="text-center text-sm text-gray-400 py-10">
          Nothing {mode === 'snoozed' ? 'snoozed' : 'set aside'} yet.
        </div>
      ) : (
        <div className="overflow-y-auto flex-1">
          {entries.map(e => (
            <div
              key={e.email_id}
              className="px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors group"
            >
              <button onClick={() => onOpen(e.email_id)} className="w-full text-left">
                <div className="text-sm font-medium text-gray-800 truncate">{e.subject || '(no subject)'}</div>
                <div className="text-xs text-gray-500 truncate">{e.sender || ''}</div>
                {mode === 'snoozed' && e.wake_date && (
                  <div className="text-xs text-amber-600 mt-0.5">Wakes {fmtWake(e.wake_date)}</div>
                )}
              </button>
              <button
                onClick={() => handleUnsnooze(e.email_id)}
                className="mt-1 text-xs text-gray-400 hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {restoreLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
