import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { SprintEmail } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onChanged?: () => void
}

type BucketKey = 'reply_now' | 'needs_thought' | 'fyi_archive' | 'delegate'
type Buckets = Record<BucketKey, SprintEmail[]>

const EMPTY: Buckets = { reply_now: [], needs_thought: [], fyi_archive: [], delegate: [] }

const COLUMNS: { key: BucketKey; title: string; emoji: string; header: string }[] = [
  { key: 'reply_now', title: 'Reply Now', emoji: '🟢', header: 'bg-green-600' },
  { key: 'needs_thought', title: 'Needs Thought', emoji: '🟡', header: 'bg-amber-500' },
  { key: 'fyi_archive', title: 'Archive', emoji: '📦', header: 'bg-gray-500' },
  { key: 'delegate', title: 'Delegate', emoji: '👥', header: 'bg-blue-600' },
]

export function InboxSprint({ open, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [buckets, setBuckets] = useState<Buckets>(EMPTY)
  const [busy, setBusy] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.sprintTriage(60)
      setBuckets({ ...EMPTY, ...res.buckets })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run sprint')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  if (!open) return null

  const act = async (key: BucketKey, action: 'mark_read' | 'archive') => {
    const ids = buckets[key].map((e) => e.id)
    if (!ids.length) return
    setBusy(`${key}:${action}`)
    try {
      await api.bulkEmailAction(action, ids)
      setBuckets((prev) => ({ ...prev, [key]: [] }))
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b">
        <h2 className="text-lg font-semibold">⚡ Inbox Zero Sprint</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={loading}
            className="text-sm px-3 py-1 rounded border hover:bg-gray-50 disabled:opacity-50"
          >
            Re-run
          </button>
          <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800">
            ×
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
          <div className="h-10 w-10 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin mb-3" />
          <p>AI is sorting your inbox…</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-red-600">{error}</div>
      ) : (
        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {COLUMNS.map((col) => (
            <div key={col.key} className="flex flex-col bg-gray-50 rounded-lg overflow-hidden min-h-0">
              <div className={`${col.header} text-white px-3 py-2 flex items-center justify-between`}>
                <span className="font-semibold text-sm">
                  {col.emoji} {col.title}
                </span>
                <span className="text-xs bg-white/25 rounded-full px-2 py-0.5">{buckets[col.key].length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {buckets[col.key].length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">Empty</p>
                ) : (
                  buckets[col.key].map((e) => (
                    <div key={e.id} className="bg-white rounded border p-2 text-xs">
                      <p className="font-medium text-gray-800 truncate">{e.sender}</p>
                      <p className="text-gray-600 truncate">{e.subject}</p>
                      <p className="text-gray-400 mt-0.5">{(e.date || '').slice(0, 10)}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="p-2 border-t bg-white space-y-1">
                <button
                  onClick={() => act(col.key, 'mark_read')}
                  disabled={!buckets[col.key].length || busy === `${col.key}:mark_read`}
                  className="w-full text-xs py-1.5 rounded border hover:bg-gray-50 disabled:opacity-40"
                >
                  Mark all read
                </button>
                {col.key === 'fyi_archive' && (
                  <button
                    onClick={() => act(col.key, 'archive')}
                    disabled={!buckets[col.key].length || busy === `${col.key}:archive`}
                    className="w-full text-xs py-1.5 rounded bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-40"
                  >
                    Archive all FYI
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
