import { useState, useEffect, useRef } from 'react'
import type { Tab } from '../contexts/UIContext'
import { api, type NLCommandPreview } from '../api/client'

interface PaletteItem { label: string; icon: string; tab: Tab; keywords: string[] }

const ITEMS: PaletteItem[] = [
  { label: 'Inbox', icon: '📧', tab: 'inbox', keywords: ['inbox', 'emails', 'mail'] },
  { label: 'Focus / Triage', icon: '🎯', tab: 'triage', keywords: ['focus', 'triage', 'inbox', 'emails'] },
  { label: 'Action Board', icon: '✅', tab: 'actions', keywords: ['actions', 'follow up', 'tasks', 'todo'] },
  { label: 'VIP Manager', icon: '⭐', tab: 'vip', keywords: ['vip', 'contacts', 'important'] },
  { label: 'Daily Digest', icon: '📰', tab: 'digest', keywords: ['digest', 'summary', 'brief'] },
  { label: 'Ask AI', icon: '🤖', tab: 'ask', keywords: ['ask', 'ai', 'search', 'rag', 'query'] },
  { label: 'Weekly Brief', icon: '📋', tab: 'weekly', keywords: ['weekly', 'brief', 'report'] },
  { label: 'Analytics', icon: '📊', tab: 'analytics', keywords: ['analytics', 'stats', 'metrics', 'chart'] },
  { label: 'Projects', icon: '🗂️', tab: 'projects', keywords: ['projects', 'gantt', 'kanban', 'tasks', 'plan'] },
  { label: 'Chase Queue', icon: '📬', tab: 'chase', keywords: ['chase', 'waiting', 'reply', 'follow'] },
  { label: 'Knowledge', icon: '🧠', tab: 'knowledge', keywords: ['knowledge', 'intelligence', 'rag', 'memory'] },
  { label: 'Health', icon: '❤️', tab: 'health', keywords: ['health', 'status', 'connection'] },
]

type Mode = 'actions' | 'nl'

export function CommandPalette({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('actions')
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // NL command state
  const [nlText, setNlText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [preview, setPreview] = useState<NLCommandPreview | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = () => {
    setQuery(''); setNlText(''); setPreview(null); setError(''); setParsing(false); setExecuting(false)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open, mode])

  const q = query.toLowerCase()
  const filtered = q
    ? ITEMS.filter(i => i.label.toLowerCase().includes(q) || i.keywords.some(k => k.includes(q)))
    : ITEMS

  const go = (item: PaletteItem) => {
    onNavigate(item.tab)
    setOpen(false)
    reset()
  }

  const runParse = async () => {
    const cmd = nlText.trim()
    if (!cmd) return
    setParsing(true); setError(''); setPreview(null)
    try {
      const result = await api.parseNLCommand(cmd)
      setPreview(result)
    } catch (e: any) {
      setError(e?.message || 'Could not interpret command')
    } finally {
      setParsing(false)
    }
  }

  const runExecute = async () => {
    if (!preview) return
    setExecuting(true); setError('')
    try {
      const result = await api.executeNLCommand(preview.command_id)
      setToast(`${preview.action.replace('_', ' ')} applied to ${result.executed} email(s)`)
      clearTimeout(toastTimerRef.current ?? undefined)
      toastTimerRef.current = setTimeout(() => setToast(''), 4000)
      setOpen(false)
      reset()
    } catch (e: any) {
      setError(e?.message || 'Execution failed')
    } finally {
      setExecuting(false)
    }
  }

  if (!open) {
    return toast ? (
      <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl">
        {toast}
      </div>
    ) : null
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-24" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-2xl shadow-2xl w-[28rem] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => { setMode('actions'); setError(''); setPreview(null) }}
            className={`flex-1 text-xs font-medium py-2.5 transition-colors ${mode === 'actions' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            Actions
          </button>
          <button
            onClick={() => { setMode('nl'); setError('') }}
            className={`flex-1 text-xs font-medium py-2.5 transition-colors ${mode === 'nl' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}>
            Inbox Command
          </button>
        </div>

        {mode === 'actions' && (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <span className="text-gray-400 text-sm">⌘</span>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Go to…"
                className="flex-1 text-sm outline-none text-gray-800 placeholder-gray-400"
              />
              <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1">Esc</kbd>
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">No results</p>
              )}
              {filtered.map(item => (
                <button key={item.tab} onClick={() => go(item)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 text-left transition-colors group">
                  <span className="text-base">{item.icon}</span>
                  <span className="text-sm text-gray-700 group-hover:text-blue-600">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-gray-100 px-4 py-2">
              <p className="text-[10px] text-gray-400">↑↓ navigate · Enter select · Esc close</p>
            </div>
          </>
        )}

        {mode === 'nl' && (
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <input
                ref={inputRef}
                value={nlText}
                onChange={e => setNlText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !parsing) runParse() }}
                maxLength={500}
                placeholder="e.g. Archive all newsletters from last week"
                className="flex-1 text-sm outline-none text-gray-800 placeholder-gray-400 border border-gray-200 rounded-lg px-3 py-2 focus:border-blue-400"
              />
              <button
                onClick={runParse}
                disabled={parsing || !nlText.trim()}
                className="text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors">
                {parsing ? '…' : 'Preview'}
              </button>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>
            )}

            {preview && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className={`px-3 py-2.5 text-sm ${preview.safe ? 'bg-blue-50 text-blue-800' : 'bg-red-50 text-red-800'}`}>
                  This will <strong>{preview.action.replace('_', ' ')}</strong> {preview.count} email{preview.count === 1 ? '' : 's'}
                  {!preview.safe && <span className="block text-xs mt-1 font-semibold">⚠ This cannot be undone</span>}
                </div>
                {preview.count > 0 && (
                  <ul className="max-h-40 overflow-y-auto divide-y divide-gray-100">
                    {preview.preview.slice(0, 5).map(em => (
                      <li key={em.id} className="px-3 py-2">
                        <p className="text-xs font-medium text-gray-800 truncate">{em.subject}</p>
                        <p className="text-[11px] text-gray-400 truncate">{em.sender}</p>
                      </li>
                    ))}
                    {preview.count > 5 && (
                      <li className="px-3 py-1.5 text-[11px] text-gray-400">+ {preview.count - 5} more</li>
                    )}
                  </ul>
                )}
                <div className="flex gap-2 px-3 py-2.5 border-t border-gray-100 bg-gray-50">
                  <button
                    onClick={runExecute}
                    disabled={executing || preview.count === 0}
                    className={`flex-1 text-xs font-medium py-2 rounded-lg text-white disabled:opacity-40 transition-colors ${preview.safe ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'}`}>
                    {executing ? 'Working…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setPreview(null); setError('') }}
                    className="flex-1 text-xs font-medium py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!preview && !error && (
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Describe what to do in plain English. Supported: archive, mark read/unread, label, snooze, delete.
                You'll always review affected emails before anything happens.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
