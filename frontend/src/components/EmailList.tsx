import { useState, useEffect, useRef } from 'react'
import type { EmailSummary } from '../types'
import type { SortBy, SortOrder } from '../hooks/useEmails'

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

export function EmailList({ emails, selectedId, loading, hasMore, total, folders, currentFolder, onSelect, onLoadMore, onSearch, onSort, onFolderChange, sortBy, sortOrder }: Props) {
  const [query, setQuery] = useState('')
  const sentinelRef = useRef<HTMLDivElement>(null)

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
        <form onSubmit={handleSearch}>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value) onSearch('')
            }}
            placeholder="Search emails…"
            className="w-full bg-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </form>
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

        {emails.map((email) => (
          <button
            key={email.id}
            onClick={() => onSelect(email)}
            className={`w-full text-left px-3 py-3 flex gap-3 hover:bg-gray-50 transition-colors border-b border-gray-50 ${
              selectedId === email.id ? 'bg-blue-50 border-l-2 border-l-accent' : ''
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
                <span className={`text-sm truncate ${!email.is_read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {email.sender.replace(/<[^>]+>/, '').trim() || email.sender}
                </span>
                <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(email.date)}</span>
              </div>
              <div className={`text-xs truncate mt-0.5 ${!email.is_read ? 'font-medium text-gray-800' : 'text-gray-600'}`}>
                {email.subject || '(no subject)'}
              </div>
              <div className="text-xs text-gray-400 truncate mt-0.5">{email.preview}</div>
            </div>
          </button>
        ))}

        <div ref={sentinelRef} className="h-4" />
        {loading && (
          <div className="text-center text-gray-400 text-xs py-3">Loading…</div>
        )}
      </div>
    </div>
  )
}
