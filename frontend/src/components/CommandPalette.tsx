import { useState, useEffect, useRef } from 'react'
import type { Tab } from '../contexts/UIContext'

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

export function CommandPalette({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(v => !v)
        setQuery('')
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const q = query.toLowerCase()
  const filtered = q
    ? ITEMS.filter(i => i.label.toLowerCase().includes(q) || i.keywords.some(k => k.includes(q)))
    : ITEMS

  const go = (item: PaletteItem) => {
    onNavigate(item.tab)
    setOpen(false)
    setQuery('')
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-24" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-2xl shadow-2xl w-96 overflow-hidden" onClick={e => e.stopPropagation()}>
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
      </div>
    </div>
  )
}
