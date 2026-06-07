import { useState, useEffect, useRef } from 'react'
import type { EmailSummary, EmailThread } from '../types'
import type { SortBy, SortOrder } from '../hooks/useEmails'
import { api } from '../api/client'
import { Avatar, Badge, Input } from './ui'

const SEARCH_HISTORY_KEY = 'email_search_history'
const MAX_HISTORY = 10

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]') }
  catch { return [] }
}

function addToHistory(q: string) {
  const prev = loadHistory().filter(h => h !== q)
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify([q, ...prev].slice(0, MAX_HISTORY)))
}

interface BulkDraft { email_id: string; subject: string; to: string; draft: string }

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
  onBulkDelete?: (ids: string[]) => void
  onBulkSnooze?: (ids: string[], date: string) => void
  onOpenCompose?: (opts: { to: string; subject: string; body: string }) => void
  sortBy: SortBy
  sortOrder: SortOrder
  total: number
  folders: Record<string, number>
  currentFolder: string
  onlyUnread?: boolean
}

function isNewEmail(dateStr: string | null): boolean {
  if (!dateStr) return false
  return (Date.now() - new Date(dateStr).getTime()) < 4 * 60 * 60 * 1000  // last 4 hours
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

export function EmailList({ emails, selectedId, loading, hasMore, total, folders, currentFolder, onSelect, onLoadMore, onSearch, onSort, onFolderChange, onBulkDelete, onBulkSnooze, onOpenCompose, sortBy, sortOrder, onlyUnread }: Props) {
  const [query, setQuery] = useState('')
  const [savedSearches, setSavedSearches] = useState<{ id: number; name: string; query: string; folder: string }[]>([])
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkSnooze, setShowBulkSnooze] = useState(false)
  const [bulkSnoozeDate, setBulkSnoozeDate] = useState('')
  const [threadView, setThreadView] = useState(false)
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [hoverSummary, setHoverSummary] = useState<Record<string, string>>({})
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [bulkDrafts, setBulkDrafts] = useState<BulkDraft[] | null>(null)
  const [generatingBulk, setGeneratingBulk] = useState(false)
  const [bulkCopiedIdx, setBulkCopiedIdx] = useState<number | null>(null)
  const [hoverTimer, setHoverTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [priorityEmails, setPriorityEmails] = useState<any[] | null>(null)
  const [loadingPriority, setLoadingPriority] = useState(false)

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

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selected)
    setSelected(new Set())
    onBulkDelete?.(ids)
  }

  const handleBulkSnooze = async () => {
    if (!bulkSnoozeDate) return
    const ids = Array.from(selected)
    setSelected(new Set())
    setShowBulkSnooze(false)
    setBulkSnoozeDate('')
    onBulkSnooze?.(ids, bulkSnoozeDate)
  }

  const handleBulkDraft = async () => {
    const ids = Array.from(selected)
    setGeneratingBulk(true)
    setBulkDrafts(null)
    try {
      const res = await api.bulkSmartDraft(ids)
      setBulkDrafts(res.drafts)
    } catch { setBulkDrafts([]) }
    setGeneratingBulk(false)
  }

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      addToHistory(query.trim())
      setHistory(loadHistory())
    }
    setShowHistory(false)
    onSearch(query)
  }

  const runHistoryItem = (q: string) => {
    setQuery(q)
    setShowHistory(false)
    addToHistory(q)
    setHistory(loadHistory())
    onSearch(q)
  }

  const clearHistory = () => {
    localStorage.removeItem(SEARCH_HISTORY_KEY)
    setHistory([])
    setShowHistory(false)
  }

  const loadThreads = async () => {
    setThreadsLoading(true)
    try {
      const res = await api.getThreads({ folder: currentFolder })
      setThreads(res.threads ?? [])
    } catch { setThreads([]) }
    setThreadsLoading(false)
  }

  const toggleThreadView = () => {
    const next = !threadView
    setThreadView(next)
    if (next) loadThreads()
  }

  const toggleSort = (field: SortBy) => {
    if (sortBy === field) {
      onSort(field, sortOrder === 'desc' ? 'asc' : 'desc')
    } else {
      onSort(field, 'desc')
    }
    setPriorityEmails(null)
  }

  const handlePrioritySort = async () => {
    if (priorityEmails) {
      setPriorityEmails(null)
      return
    }
    setLoadingPriority(true)
    try {
      const { emails } = await api.getPrioritySorted(currentFolder, 50)
      setPriorityEmails(emails)
    } catch { /* silent */ } finally { setLoadingPriority(false) }
  }

  const SortBtn = ({ field, label }: { field: SortBy; label: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className={
        sortBy === field
          ? 'bg-accent-500 text-white text-xs px-2.5 py-1 rounded-lg font-medium'
          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 text-xs px-2.5 py-1 rounded-lg transition-all'
      }
    >
      {label}
      {sortBy === field && (
        <span className="ml-0.5">{sortOrder === 'desc' ? '↓' : '↑'}</span>
      )}
    </button>
  )

  // Inbox always first, then the rest sorted alphabetically
  const folderNames = [
    ...Object.keys(folders).filter(f => f.toUpperCase() === 'INBOX'),
    ...Object.keys(folders).filter(f => f.toUpperCase() !== 'INBOX').sort(),
  ]

  return (
    <div className="flex flex-col h-full border-r border-gray-200 bg-white">
      {/* Folder selector */}
      {folderNames.length > 0 && (
        <div className="flex gap-1 px-3 py-2 border-b border-gray-100 overflow-x-auto flex-shrink-0">
          {folderNames.map((f) => {
            const isInbox = f.toUpperCase() === 'INBOX'
            const isActive = currentFolder === f
            return (
              <button
                key={f}
                onClick={() => onFolderChange(f)}
                title={`${folders[f].toLocaleString()} emails`}
                className={`text-xs px-2.5 py-0.5 rounded-full whitespace-nowrap transition-colors ${
                  isActive
                    ? isInbox
                      ? 'bg-indigo-600 text-white'
                      : 'bg-accent text-white'
                    : isInbox
                      ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
                <span className={`ml-1 ${isActive ? 'text-blue-200' : isInbox ? 'text-indigo-400' : 'text-gray-400'}`}>
                  {folders[f] > 999 ? `${Math.floor(folders[f] / 1000)}k` : folders[f]}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Search */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
        <form onSubmit={handleSearch} className="flex gap-1 relative">
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value) onSearch('')
            }}
            onFocus={() => setShowHistory(history.length > 0)}
            onBlur={() => setTimeout(() => setShowHistory(false), 150)}
            placeholder="Search emails…"
            className="flex-1"
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
          {showHistory && history.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
              {history.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={() => runHistoryItem(h)}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                >
                  <svg className="w-3 h-3 text-gray-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
                  </svg>
                  <span className="truncate">{h}</span>
                </button>
              ))}
              <div className="border-t border-gray-100 mt-1 pt-1 px-3">
                <button type="button" onMouseDown={clearHistory} className="text-[10px] text-gray-400 hover:text-red-400">Clear history</button>
              </div>
            </div>
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
        {/* Sort controls / bulk toolbar */}
        {selected.size > 0 ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-gray-700">{selected.size} selected</span>
              {onBulkDelete && (
                <button onClick={handleBulkDelete} className="text-xs text-red-500 hover:text-red-700 px-2 py-0.5 rounded hover:bg-red-50 transition-colors">Delete</button>
              )}
              {onBulkSnooze && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowBulkSnooze(v => !v)} className="text-xs text-amber-600 hover:text-amber-800 px-2 py-0.5 rounded hover:bg-amber-50 transition-colors">Snooze</button>
                  {showBulkSnooze && (
                    <>
                      <input type="date" value={bulkSnoozeDate} min={tomorrowStr} onChange={e => setBulkSnoozeDate(e.target.value)}
                        className="text-[10px] border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent" />
                      <button onClick={handleBulkSnooze} disabled={!bulkSnoozeDate}
                        className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded disabled:opacity-50">OK</button>
                    </>
                  )}
                </div>
              )}
              {selected.size >= 2 && (
                <button
                  onClick={handleBulkDraft}
                  disabled={generatingBulk}
                  className="text-xs text-accent hover:text-blue-700 px-2 py-0.5 rounded hover:bg-blue-50 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {generatingBulk ? <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin inline-block" /> : null}
                  {generatingBulk ? 'Drafting…' : 'Draft all'}
                </button>
              )}
              <button onClick={() => { setSelected(new Set()); setBulkDrafts(null) }} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">Clear</button>
            </div>
            {bulkDrafts !== null && (
              <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{bulkDrafts.length} draft{bulkDrafts.length !== 1 ? 's' : ''} generated</p>
                  <button onClick={() => setBulkDrafts(null)} className="text-[10px] text-gray-400 hover:text-gray-600">Dismiss</button>
                </div>
                {bulkDrafts.map((d, i) => (
                  <div key={d.email_id} className="border border-gray-200 rounded-lg p-2 bg-white text-xs space-y-1">
                    <p className="font-medium text-gray-800 truncate">{d.subject}</p>
                    <p className="text-gray-400 truncate">To: {d.to}</p>
                    <p className="text-gray-600 line-clamp-2">{d.draft.slice(0, 100)}{d.draft.length > 100 ? '…' : ''}</p>
                    <div className="flex gap-2 pt-0.5">
                      {onOpenCompose ? (
                        <button
                          onClick={() => onOpenCompose({ to: d.to, subject: d.subject, body: d.draft })}
                          className="text-accent hover:text-blue-700 font-medium"
                        >
                          Compose
                        </button>
                      ) : null}
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(d.draft).catch(() => {})
                          setBulkCopiedIdx(i)
                          setTimeout(() => setBulkCopiedIdx(null), 1500)
                        }}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        {bulkCopiedIdx === i ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{total.toLocaleString()} emails</span>
              <button
                onClick={toggleThreadView}
                className={threadView ? 'bg-accent-500 text-white text-xs px-2.5 py-1 rounded-lg font-medium' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 text-xs px-2.5 py-1 rounded-lg transition-all'}
                title="Toggle thread view"
              >
                Threads
              </button>
            </div>
            {!threadView && (
              <div className="flex gap-1">
                <SortBtn field="date" label="Date" />
                <SortBtn field="sender" label="From" />
                <SortBtn field="subject" label="Subject" />
                <button
                  onClick={handlePrioritySort}
                  disabled={loadingPriority}
                  className={priorityEmails ? 'bg-accent-500 text-white text-xs px-2.5 py-1 rounded-lg font-medium' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 text-xs px-2.5 py-1 rounded-lg transition-all disabled:opacity-50'}
                >
                  {loadingPriority ? '⟳' : priorityEmails ? 'Priority ✕' : 'Priority'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {/* Thread view */}
        {threadView && (
          <>
            {threadsLoading && <div className="text-xs text-gray-400 text-center mt-8">Loading threads…</div>}
            {!threadsLoading && threads.length === 0 && <div className="text-xs text-gray-400 text-center mt-8">No threads</div>}
            {threads.map(t => {
              const hasUnread = t.messages?.some(m => !m.is_read)
              const preview = t.messages?.[0]?.preview || ''
              return (
                <div key={t.thread_id} className="border-b border-gray-50 px-3 py-3 hover:bg-gray-50 cursor-pointer group"
                  onClick={() => onSearch(t.subject || '')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {hasUnread && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />}
                        <span className={`text-sm truncate ${hasUnread ? 'font-bold text-gray-900' : 'text-gray-700'}`}>{t.subject || '(no subject)'}</span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{t.participants?.slice(0, 2).join(', ')}</p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{preview}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs text-gray-400">{formatDate(t.latest_date)}</span>
                      <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 font-medium">{t.message_count}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}

        {onlyUnread && !threadView && (
          <div className="px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px] text-blue-600 font-medium flex items-center justify-between sticky top-0 z-10">
            <span>Showing unread only</span>
          </div>
        )}
        {!threadView && (priorityEmails ?? emails).filter(e => !onlyUnread || !e.is_read).length === 0 && !loading && (
          <div className="text-center text-gray-400 text-sm mt-12">
            {onlyUnread ? 'No unread emails 🎉' : 'No emails'}
          </div>
        )}

        {!threadView && (priorityEmails ?? emails).filter(e => !onlyUnread || !e.is_read).map((email) => {
          const label = priorityLabel(email.subject || '', email.preview || '')
          const depth = replyDepth(email.subject || '')
          const isNew = isNewEmail(email.date) && !email.is_read
          const isSelected = selected.has(email.id)
          return (
            <div
              key={email.id}
              className="relative group border-b border-gray-50"
              onMouseEnter={() => {
                setHoveredId(email.id)
                if (!hoverSummary[email.id]) {
                  const timer = setTimeout(async () => {
                    try {
                      const { summary } = await api.getOneLineSummary(email.id)
                      if (summary) {
                        setHoverSummary(prev => ({ ...prev, [email.id]: summary }))
                      }
                    } catch { /* ignore */ }
                  }, 600)
                  setHoverTimer(timer)
                }
              }}
              onMouseLeave={() => {
                setHoveredId(null)
                if (hoverTimer) {
                  clearTimeout(hoverTimer)
                  setHoverTimer(null)
                }
              }}
            >
              {/* Checkbox over avatar */}
              <div
                className={`absolute left-3 top-3 z-10 cursor-pointer transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={(e) => toggleSelect(email.id, e)}
              >
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-accent border-accent' : 'bg-white/90 border-gray-300'}`}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  )}
                </div>
              </div>

              <button
                onClick={() => onSelect(email)}
                className={`w-full text-left px-3 py-3 flex gap-3 transition-colors ${
                  isSelected ? 'bg-blue-50/60' :
                  selectedId === email.id ? 'bg-blue-50 border-l-2 border-l-accent' :
                  !email.is_read ? 'bg-amber-50 border-l-2 border-l-amber-400 hover:bg-amber-100' :
                  'hover:bg-gray-50'
                }`}
              >
                {/* Avatar */}
                <Avatar name={email.sender} size="sm" className={`mt-0.5 transition-opacity ${isSelected ? 'opacity-20' : 'group-hover:opacity-20'}`} />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {!email.is_read && (
                        <span className="flex-shrink-0 w-2 h-2 rounded-full bg-accent" />
                      )}
                      <span className={`text-sm truncate ${!email.is_read ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                        {email.sender.replace(/<[^>]+>/, '').trim() || email.sender}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {email.preview && (
                        <span className="text-[10px] text-gray-300">
                          ~{Math.max(1, Math.round((email.preview.split(' ').length * 5) / 200))}m
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{formatDate(email.date)}</span>
                    </span>
                  </div>
                  <div className={`flex items-center gap-1 mt-0.5 ${!email.is_read ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                    {depth > 0 && (
                      <span className="text-[10px] bg-gray-100 text-gray-500 rounded-md px-1.5 py-0.5 flex-shrink-0 font-medium tabular-nums">
                        {depth}↩
                      </span>
                    )}
                    <span className="text-xs truncate">{email.subject || '(no subject)'}</span>
                    {isNew && (
                      <Badge variant="new">New</Badge>
                    )}
                    {label && (
                      <Badge variant={label.cls.includes('red') ? 'danger' : label.cls.includes('orange') ? 'orange' : 'purple'}>{label.text}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">{email.preview}</div>
                </div>
              </button>

              {/* Hover AI summary tooltip */}
              {hoverSummary[email.id] && hoveredId === email.id && (
                <div className="absolute left-3 right-3 -bottom-8 z-20 bg-gray-900 text-white text-xs rounded-lg px-3 py-1.5 shadow-lg pointer-events-none">
                  {hoverSummary[email.id]}
                </div>
              )}
            </div>
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
