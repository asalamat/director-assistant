import { useState, useEffect, useRef } from 'react'
import type { EmailSummary } from '../types'
import type { SortBy, SortOrder } from '../hooks/useEmails'
import { api } from '../api/client'

interface Props {
  emails: EmailSummary[]
  selectedId: string | null
  loading: boolean
  hasMore: boolean
  onSelect: (email: EmailSummary) => void
  onLoadMore: () => void
  onSearch: (q: string) => void
  onSort: (by: SortBy, order: SortOrder) => void
  onFolderChange: (folder: string) => void
  sortBy: SortBy
  sortOrder: SortOrder
  total: number
  folders: Record<string, number>
  currentFolder: string
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function initials(sender: string): string {
  const parts = sender.replace(/<.*>/, '').trim().split(' ')
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-rose-500',
  'bg-amber-500', 'bg-teal-500', 'bg-pink-500',
]

function avatarColor(sender: string): string {
  let hash = 0
  for (const ch of sender) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function priorityLabel(subject: string, preview: string): { text: string; cls: string } | null {
  const hay = `${subject} ${preview}`.toLowerCase()
  if (/\burgent\b|\basap\b|\bimmediately\b|\bdeadline\b/.test(hay))
    return { text: 'urgent', cls: 'bg-red-100 text-red-600' }
  if (/action required|action needed|please review|response required/.test(hay))
    return { text: 'action', cls: 'bg-orange-100 text-orange-600' }
  if (/\binvoice\b|\bpayment\b|\bcontract\b/.test(hay))
    return { text: 'finance', cls: 'bg-purple-100 text-purple-600' }
  return null
}

function replyDepth(subject: string): number {
  let depth = 0
  let s = subject
  while (/^re:\s*/i.test(s)) { depth++; s = s.replace(/^re:\s*/i, '') }
  return depth
}

export function EmailList({ emails, selectedId, loading, hasMore, total, folders, currentFolder, onSelect, onLoadMore, onSearch, onSort, onFolderChange, sortBy, sortOrder }: Props) {
  const [query, setQuery] = useState('')
  const [savedSearches, setSavedSearches] = useState<{ id: number; name: string; query: string; folder: string }[]>([])
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.getSavedSearches().then(setSavedSearches).catch(() => {})
  }, [])

  const pinSearch = async () => {
    if (!query.trim()) return
    const name = prompt('Name this search:', query.trim())
    if (!name) return
    await api.createSavedSearch(name, query.trim(), currentFolder)
    setSavedSearches(await api.getSavedSearches())
  }

  const deletePin = async (id: number) => {
    await api.deleteSavedSearch(id)
    setSavedSearches(prev => prev.filter(s => s.id !== id))
  }

  const runSaved = (s: { query: string; folder: string }) => {
    setQuery(s.query)
    onFolderChange(s.folder)
    onSearch(s.query)
  }

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loading) onLoadMore()
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, loading, onLoadMore])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    onSearch(query)
  }

  const toggleSort = (field: SortBy) => {
    if (sortBy === field) {
      onSort(field, sortOrder === 'desc' ? 'asc' : 'desc')
    } else {
      onSort(field, 'desc')
    }
  }

  const SortBtn = ({ field, label }: { field: SortBy; label: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className={`text-xs px-2 py-0.5 rounded transition-colors ${
        sortBy === field
          ? 'bg-accent text-white'
          : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
      }`}
    >
      {label}
      {sortBy === field && (
        <span className="ml-0.5">{sortOrder === 'desc' ? '↓' : '↑'}</span>
      )}
    </button>
  )

  const folderNames = Object.keys(folders).sort()

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white">
      {/* Folder selector */}
      {folderNames.length > 1 && (
        <div className="flex gap-1 px-3 py-2 border-b border-gray-100 overflow-x-auto flex-shrink-0">
          {folderNames.map((f) => (
            <button
              key={f}
              onClick={() => onFolderChange(f)}
              title={`${folders[f].toLocaleString()} emails`}
              className={`text-xs px-2.5 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                currentFolder === f
                  ? 'bg-accent text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f}
              <span className={`ml-1 ${currentFolder === f ? 'text-blue-200' : 'text-gray-400'}`}>
                {folders[f] > 999 ? `${Math.floor(folders[f] / 1000)}k` : folders[f]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
        <form onSubmit={handleSearch} className="flex gap-1">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value) onSearch('')
            }}
            placeholder="Search emails…"
            className="flex-1 bg-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {query.trim() && (
            <button
              type="button"
              onClick={pinSearch}
              title="Pin this search"
              className="text-gray-400 hover:text-accent px-2 rounded-lg hover:bg-gray-100"
            >
              📌
            </button>
          )}
        </form>
        {/* Saved searches */}
        {savedSearches.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {savedSearches.map(s => (
              <div key={s.id} className="flex items-center gap-0.5 bg-blue-50 border border-blue-200 rounded-full pl-2 pr-1 py-0.5">
                <button
                  onClick={() => runSaved(s)}
                  className="text-[10px] text-blue-700 font-medium max-w-[80px] truncate"
                  title={s.query}
                >
                  {s.name}
                </button>
                <button
                  onClick={() => deletePin(s.id)}
                  className="text-blue-300 hover:text-red-400 text-[10px] px-0.5"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Sort controls */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">{total.toLocaleString()} emails</span>
          <div className="flex gap-1">
            <SortBtn field="date" label="Date" />
            <SortBtn field="sender" label="From" />
            <SortBtn field="subject" label="Subject" />
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {emails.length === 0 && !loading && (
          <div className="text-center text-gray-400 text-sm mt-12">No emails</div>
        )}

        {emails.map((email) => {
          const label = priorityLabel(email.subject || '', email.preview || '')
          const depth = replyDepth(email.subject || '')
          return (
            <button
              key={email.id}
              onClick={() => onSelect(email)}
              className={`w-full text-left px-3 py-3 flex gap-3 transition-colors border-b border-gray-50 ${
                selectedId === email.id
                  ? 'bg-blue-50 border-l-2 border-l-accent'
                  : !email.is_read
                  ? 'bg-amber-50 border-l-2 border-l-amber-400 hover:bg-amber-100'
                  : 'hover:bg-gray-50'
              }`}
            >
              {/* Avatar */}
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full ${avatarColor(email.sender)} text-white text-xs font-semibold flex items-center justify-center mt-0.5`}
              >
                {initials(email.sender) || '?'}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-sm truncate ${!email.is_read ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                    {email.sender.replace(/<[^>]+>/, '').trim() || email.sender}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(email.date)}</span>
                </div>
                <div className={`flex items-center gap-1 mt-0.5 ${!email.is_read ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                  {depth > 0 && (
                    <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1 flex-shrink-0">
                      ↩{depth > 1 ? depth : ''}
                    </span>
                  )}
                  <span className="text-xs truncate">{email.subject || '(no subject)'}</span>
                  {label && (
                    <span className={`text-[10px] px-1.5 rounded-full font-medium flex-shrink-0 ${label.cls}`}>{label.text}</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 truncate mt-0.5">{email.preview}</div>
              </div>
            </button>
          )
        })}

        <div ref={sentinelRef} className="h-4" />
        {loading && (
          <div className="text-center text-gray-400 text-xs py-3">Loading…</div>
        )}
      </div>
    </div>
  )
}
