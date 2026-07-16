import { useState, useEffect, useRef } from 'react'
import { CATEGORY_LABELS } from '../types'
import type { EmailSummary, EmailThread, AutopilotRule } from '../types'
import type { SortBy, SortOrder } from '../hooks/useEmails'
import { api } from '../api/client'
import { Avatar, Badge, Input } from './ui'
import { InboxSprint } from './InboxSprint'
import { SnoozedFolderView } from './SnoozedFolderView'

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

interface FilterState {
  from_date?: string
  to_date?: string
  sender_filter?: string
  category?: string | undefined
  has_attachment?: boolean
  only_unread?: boolean
}

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
  onBulkArchive?: (ids: string[]) => void
  onBulkMarkRead?: (ids: string[]) => void
  onOpenCompose?: (opts: { to: string; subject: string; body: string }) => void
  sortBy: SortBy
  sortOrder: SortOrder
  total: number
  folders: Record<string, number>
  currentFolder: string
  onlyUnread?: boolean
  activeCategory?: string | null
  onCategoryChange?: (cat: string | null) => void
  onFilterChange?: (filters: FilterState) => void
  autopilotRules?: AutopilotRule[]
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


function ageBadge(date: string | null): { label: string; cls: string } | null {
  if (!date) return null
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days >= 30) return { label: '30d+', cls: 'bg-red-100 text-red-600' }
  if (days >= 14) return { label: '14d', cls: 'bg-orange-100 text-orange-600' }
  if (days >= 7)  return { label: '7d',  cls: 'bg-amber-100 text-amber-600' }
  return null
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

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const terms = query.trim().split(/\s+/).filter(t => t.length > 2).slice(0, 5)
  if (!terms.length) return <>{text}</>
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part)
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5 not-italic">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

function replyDepth(subject: string): number {
  let depth = 0
  let s = subject
  while (/^re:\s*/i.test(s)) { depth++; s = s.replace(/^re:\s*/i, '') }
  return depth
}

export function EmailList({ emails, selectedId, loading, hasMore, total, folders, currentFolder, onSelect, onLoadMore, onSearch, onSort, onFolderChange, onBulkDelete, onBulkSnooze, onBulkArchive, onBulkMarkRead, onOpenCompose, sortBy, sortOrder, onlyUnread, activeCategory, onCategoryChange, onFilterChange, autopilotRules }: Props) {
  const [query, setQuery] = useState('')
  const [savedSearches, setSavedSearches] = useState<{ id: number; name: string; query: string; folder: string }[]>([])
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkSnooze, setShowBulkSnooze] = useState(false)
  const [bulkSnoozeDate, setBulkSnoozeDate] = useState('')
  const [showSprint, setShowSprint] = useState(false)
  const [threadView, setThreadView] = useState(false)
  const [virtualFolder, setVirtualFolder] = useState<'snoozed' | 'set-aside' | null>(null)
  const [threads, setThreads] = useState<EmailThread[]>([])
  const [threadsLoading, setThreadsLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [hoverSummary, setHoverSummary] = useState<Record<string, string>>({})
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const [hoverLoading, setHoverLoading] = useState(false)
  const [bulkDrafts, setBulkDrafts] = useState<BulkDraft[] | null>(null)
  const [generatingBulk, setGeneratingBulk] = useState(false)
  const [bulkCopiedIdx, setBulkCopiedIdx] = useState<number | null>(null)
  const [hoverTimer, setHoverTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [priorityEmails, setPriorityEmails] = useState<any[] | null>(null)
  const [loadingPriority, setLoadingPriority] = useState(false)
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [filterFromDate, setFilterFromDate] = useState('')
  const [filterToDate, setFilterToDate] = useState('')
  const [filterSender, setFilterSender] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterHasAttachment, setFilterHasAttachment] = useState(false)
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false)
  const [aiPreviews, setAiPreviews] = useState<Record<string, string>>({})
  const fetchedPreviewIds = useRef<Set<string>>(new Set())
  const previewObserverRef = useRef<IntersectionObserver | null>(null)

  // Lazily fetch AI preview when a row enters the viewport
  const observeEmailRow = (el: HTMLDivElement | null, emailId: string) => {
    if (!el) return
    if (fetchedPreviewIds.current.has(emailId)) return
    if (!previewObserverRef.current) {
      previewObserverRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            const id = (entry.target as HTMLElement).dataset.emailId
            if (!id || fetchedPreviewIds.current.has(id)) return
            fetchedPreviewIds.current.add(id)
            previewObserverRef.current?.unobserve(entry.target)
            api.getEmailPreview(id)
              .then(({ preview }) => {
                if (preview) setAiPreviews(prev => ({ ...prev, [id]: preview }))
              })
              .catch(() => {})
          })
        },
        { rootMargin: '100px' },
      )
    }
    el.dataset.emailId = emailId
    previewObserverRef.current.observe(el)
  }

  useEffect(() => {
    api.getSavedSearches().then(setSavedSearches).catch(() => {})
  }, [])

  useEffect(() => {
    const unread = emails.filter(e => !e.is_read).length
    document.title = unread > 0 ? `Director (${unread})` : 'Director'
    return () => { document.title = 'Director' }
  }, [emails])

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

  const handleBulkArchive = async () => {
    const ids = Array.from(selected)
    setSelected(new Set())
    onBulkArchive?.(ids)
  }

  const handleBulkMarkRead = async () => {
    const ids = Array.from(selected)
    setSelected(new Set())
    onBulkMarkRead?.(ids)
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

  const activeFilterCount = [
    filterFromDate, filterToDate, filterSender, filterCategory,
    filterHasAttachment ? 'att' : '', filterUnreadOnly ? 'unread' : '',
  ].filter(Boolean).length

  const applyFilters = () => {
    const filters: FilterState = {}
    if (filterFromDate) filters.from_date = filterFromDate
    if (filterToDate) filters.to_date = filterToDate
    if (filterSender.trim()) filters.sender_filter = filterSender.trim()
    if (filterCategory) filters.category = filterCategory
    if (filterHasAttachment) filters.has_attachment = true
    if (filterUnreadOnly) filters.only_unread = true
    onFilterChange?.(filters)
  }

  const clearFilters = () => {
    setFilterFromDate('')
    setFilterToDate('')
    setFilterSender('')
    setFilterCategory('')
    setFilterHasAttachment(false)
    setFilterUnreadOnly(false)
    onFilterChange?.({})
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
    <div className="relative flex flex-col h-full border-r border-gray-200 bg-white">
      {/* Folder selector + smart folders */}
      {(folderNames.length > 0 || savedSearches.length > 0) && (
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
          {savedSearches.length > 0 && (
            <>
              <div className="w-px bg-gray-200 mx-1 self-stretch flex-shrink-0" />
              {savedSearches.map(s => (
                <button key={s.id}
                  onClick={() => runSaved(s)}
                  className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                    query === s.query && currentFolder === s.folder
                      ? 'bg-accent/10 text-accent border border-accent/20'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-transparent'
                  }`}
                >
                  🔍 {s.name}
                </button>
              ))}
            </>
          )}
          <div className="w-px bg-gray-200 mx-1 self-stretch flex-shrink-0" />
          <button
            onClick={() => setVirtualFolder(v => v === 'snoozed' ? null : 'snoozed')}
            title="Snoozed emails"
            className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
              virtualFolder === 'snoozed'
                ? 'bg-amber-500 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            😴 Snoozed
          </button>
          <button
            onClick={() => setVirtualFolder(v => v === 'set-aside' ? null : 'set-aside')}
            title="Set-aside emails"
            className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
              virtualFolder === 'set-aside'
                ? 'bg-indigo-500 text-white'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            }`}
          >
            📌 Set Aside
          </button>
        </div>
      )}

      {virtualFolder && (
        <div className="absolute inset-x-0 bottom-0 top-[42px] z-10 bg-white">
          <SnoozedFolderView
            mode={virtualFolder}
            onClose={() => setVirtualFolder(null)}
            onOpen={(emailId) => {
              const entrySummary: EmailSummary = {
                id: emailId, subject: '', sender: '', date: null, preview: '', is_read: true,
              }
              onSelect(entrySummary)
              setVirtualFolder(null)
            }}
          />
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
          {onFilterChange && (
            <button
              type="button"
              onClick={() => setShowFilterPanel(v => !v)}
              title="Advanced filters"
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-all flex-shrink-0 ${
                showFilterPanel || activeFilterCount > 0
                  ? 'bg-accent-50 border-accent-300 text-accent-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-accent-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSprint(true)}
            title="Inbox Zero Sprint — AI buckets your unread mail"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-all flex-shrink-0"
          >
            ⚡ Sprint
          </button>
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
        {/* Advanced filter panel */}
        {onFilterChange && showFilterPanel && (
          <div className="border border-accent-100 rounded-lg p-2.5 bg-accent-50/40 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">From date</label>
                <input
                  type="date"
                  value={filterFromDate}
                  onChange={e => setFilterFromDate(e.target.value)}
                  className="w-full text-[11px] border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">To date</label>
                <input
                  type="date"
                  value={filterToDate}
                  onChange={e => setFilterToDate(e.target.value)}
                  className="w-full text-[11px] border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Sender contains</label>
              <input
                type="text"
                value={filterSender}
                onChange={e => setFilterSender(e.target.value)}
                placeholder="e.g. john@example.com"
                className="w-full text-[11px] border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Category</label>
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="w-full text-[11px] border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
              >
                <option value="">All categories</option>
                <option value="proposal">Proposal</option>
                <option value="contract">Contract</option>
                <option value="invoice">Invoice</option>
                <option value="meeting">Meeting</option>
                <option value="action_required">Action Required</option>
                <option value="fyi">FYI</option>
                <option value="newsletter">Newsletter</option>
              </select>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filterHasAttachment}
                  onChange={e => setFilterHasAttachment(e.target.checked)}
                  className="w-3.5 h-3.5 accent-accent-500"
                />
                <span className="text-[11px] text-gray-600">Has attachment</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filterUnreadOnly}
                  onChange={e => setFilterUnreadOnly(e.target.checked)}
                  className="w-3.5 h-3.5 accent-accent-500"
                />
                <span className="text-[11px] text-gray-600">Unread only</span>
              </label>
            </div>
            <div className="flex gap-2 pt-0.5">
              <button
                type="button"
                onClick={applyFilters}
                className="flex-1 text-xs bg-accent-500 text-white py-1 rounded-md hover:bg-accent-600 transition-colors font-medium"
              >
                Apply
              </button>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs px-3 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
        {/* Active filter chips */}
        {onFilterChange && activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-1">
            {filterFromDate && (
              <span className="flex items-center gap-1 text-[10px] bg-accent-100 text-accent-700 rounded-full px-2 py-0.5">
                From: {filterFromDate}
                <button onClick={() => {
                  setFilterFromDate('')
                  onFilterChange({ ...(filterToDate ? { to_date: filterToDate } : {}), ...(filterSender.trim() ? { sender_filter: filterSender } : {}), ...(filterCategory ? { category: filterCategory } : {}), ...(filterHasAttachment ? { has_attachment: true } : {}), ...(filterUnreadOnly ? { only_unread: true } : {}) })
                }} className="hover:text-red-500 font-bold">✕</button>
              </span>
            )}
            {filterToDate && (
              <span className="flex items-center gap-1 text-[10px] bg-accent-100 text-accent-700 rounded-full px-2 py-0.5">
                To: {filterToDate}
                <button onClick={() => {
                  setFilterToDate('')
                  onFilterChange({ ...(filterFromDate ? { from_date: filterFromDate } : {}), ...(filterSender.trim() ? { sender_filter: filterSender } : {}), ...(filterCategory ? { category: filterCategory } : {}), ...(filterHasAttachment ? { has_attachment: true } : {}), ...(filterUnreadOnly ? { only_unread: true } : {}) })
                }} className="hover:text-red-500 font-bold">✕</button>
              </span>
            )}
            {filterSender && (
              <span className="flex items-center gap-1 text-[10px] bg-accent-100 text-accent-700 rounded-full px-2 py-0.5">
                Sender: {filterSender}
                <button onClick={() => {
                  setFilterSender('')
                  onFilterChange({ ...(filterFromDate ? { from_date: filterFromDate } : {}), ...(filterToDate ? { to_date: filterToDate } : {}), ...(filterCategory ? { category: filterCategory } : {}), ...(filterHasAttachment ? { has_attachment: true } : {}), ...(filterUnreadOnly ? { only_unread: true } : {}) })
                }} className="hover:text-red-500 font-bold">✕</button>
              </span>
            )}
            {filterCategory && (
              <span className="flex items-center gap-1 text-[10px] bg-accent-100 text-accent-700 rounded-full px-2 py-0.5">
                {CATEGORY_LABELS[filterCategory as import('../types').EmailCategory]?.text ?? filterCategory}
                <button onClick={() => {
                  setFilterCategory('')
                  onFilterChange({ ...(filterFromDate ? { from_date: filterFromDate } : {}), ...(filterToDate ? { to_date: filterToDate } : {}), ...(filterSender.trim() ? { sender_filter: filterSender } : {}), ...(filterHasAttachment ? { has_attachment: true } : {}), ...(filterUnreadOnly ? { only_unread: true } : {}) })
                }} className="hover:text-red-500 font-bold">✕</button>
              </span>
            )}
            {filterHasAttachment && (
              <span className="flex items-center gap-1 text-[10px] bg-accent-100 text-accent-700 rounded-full px-2 py-0.5">
                Has attachment
                <button onClick={() => {
                  setFilterHasAttachment(false)
                  onFilterChange({ ...(filterFromDate ? { from_date: filterFromDate } : {}), ...(filterToDate ? { to_date: filterToDate } : {}), ...(filterSender.trim() ? { sender_filter: filterSender } : {}), ...(filterCategory ? { category: filterCategory } : {}), ...(filterUnreadOnly ? { only_unread: true } : {}) })
                }} className="hover:text-red-500 font-bold">✕</button>
              </span>
            )}
            {filterUnreadOnly && (
              <span className="flex items-center gap-1 text-[10px] bg-accent-100 text-accent-700 rounded-full px-2 py-0.5">
                Unread only
                <button onClick={() => {
                  setFilterUnreadOnly(false)
                  onFilterChange({ ...(filterFromDate ? { from_date: filterFromDate } : {}), ...(filterToDate ? { to_date: filterToDate } : {}), ...(filterSender.trim() ? { sender_filter: filterSender } : {}), ...(filterCategory ? { category: filterCategory } : {}), ...(filterHasAttachment ? { has_attachment: true } : {}) })
                }} className="hover:text-red-500 font-bold">✕</button>
              </span>
            )}
          </div>
        )}
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
              {onBulkArchive && (
                <button onClick={handleBulkArchive} className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-0.5 rounded hover:bg-indigo-50 transition-colors">Archive</button>
              )}
              {onBulkMarkRead && (
                <button onClick={handleBulkMarkRead} className="text-xs text-green-600 hover:text-green-800 px-2 py-0.5 rounded hover:bg-green-50 transition-colors">Mark read</button>
              )}
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
              <button onClick={() => { setSelected(new Set()); setBulkDrafts(null) }} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">Clear ✕</button>
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

      {/* Category filter bar */}
      {onCategoryChange && (
        <div className="flex gap-1 px-3 py-1.5 border-b border-gray-100 overflow-x-auto flex-shrink-0">
          {([null, 'proposal', 'contract', 'invoice', 'meeting', 'action_required'] as const).map(cat => {
            const isActive = activeCategory === cat
            const label = cat ? CATEGORY_LABELS[cat]?.text : 'All'
            return (
              <button key={cat ?? 'all'} onClick={() => onCategoryChange(cat)}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0 ${
                  isActive
                    ? (cat ? `${CATEGORY_LABELS[cat].cls} border border-current/30` : 'bg-accent text-white')
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                {label}
              </button>
            )
          })}
        </div>
      )}

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
              ref={(el) => observeEmailRow(el, email.id)}
              className="relative group border-b border-gray-50"
              onMouseEnter={(e) => {
                if (selectedId === email.id) return
                setHoveredId(email.id)
                setHoverPos({ x: e.clientX, y: e.clientY })
                if (!hoverSummary[email.id]) {
                  const timer = setTimeout(async () => {
                    setHoverLoading(true)
                    try {
                      const { summary } = await api.summarizeThread(email.id)
                      if (summary) {
                        setHoverSummary(prev => ({ ...prev, [email.id]: summary }))
                      }
                    } catch { /* ignore */ } finally {
                      setHoverLoading(false)
                    }
                  }, 600)
                  setHoverTimer(timer)
                }
              }}
              onMouseLeave={() => {
                setHoveredId(null)
                setHoverLoading(false)
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
                      {currentFolder.toUpperCase() === 'INBOX' && (() => {
                        const age = ageBadge(email.date)
                        return age ? (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${age.cls}`}>
                            {age.label}
                          </span>
                        ) : null
                      })()}
                      <span className="text-xs text-gray-400">{formatDate(email.date)}</span>
                    </span>
                  </div>
                  {(() => {
                    const senderAddr = (email.sender.match(/<([^>]+)>/) || [])[1]?.toLowerCase() || email.sender.toLowerCase().trim()
                    const apRule = autopilotRules?.find(r => r.mode !== 'off' && r.email_addr.toLowerCase() === senderAddr)
                    return apRule ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 flex items-center gap-0.5 ${apRule.mode === 'reply' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}
                          title={apRule.mode === 'reply' ? 'Autopilot: will auto-reply' : 'Autopilot: will save draft'}
                        >
                          🤖 {apRule.mode === 'reply' ? 'Auto-Reply' : 'Draft'}
                        </span>
                      </div>
                    ) : null
                  })()}
                  <div className={`flex items-center gap-1 mt-0.5 ${!email.is_read ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                    {depth > 0 && (
                      <span className="text-[10px] bg-gray-100 text-gray-500 rounded-md px-1.5 py-0.5 flex-shrink-0 font-medium tabular-nums">
                        {depth}↩
                      </span>
                    )}
                    <span className="text-xs truncate">{query.trim() ? <Highlight text={email.subject || '(no subject)'} query={query} /> : (email.subject || '(no subject)')}</span>
                    {isNew && (
                      <Badge variant="new">New</Badge>
                    )}
                    {label && (
                      <Badge variant={label.cls.includes('red') ? 'danger' : label.cls.includes('orange') ? 'orange' : 'purple'}>{label.text}</Badge>
                    )}
                    {email.category && !['other','fyi','newsletter'].includes(email.category) && CATEGORY_LABELS[email.category as import('../types').EmailCategory] && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${CATEGORY_LABELS[email.category as import('../types').EmailCategory].cls}`}>
                        {CATEGORY_LABELS[email.category as import('../types').EmailCategory].text}
                      </span>
                    )}
                  </div>
                  {/* AI 1-sentence preview — lazily loaded via IntersectionObserver */}
                  {aiPreviews[email.id] ? (
                    <div className="text-xs text-gray-400 mt-0.5 truncate italic leading-snug">
                      {aiPreviews[email.id]}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">{email.preview && query.trim() ? <Highlight text={email.preview} query={query} /> : email.preview}</div>
                  )}
                </div>
              </button>

              {/* Add to Autopilot — hover action */}
              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    const senderEmail = email.sender.match(/<([^>]+)>/)?.[1] || email.sender.trim()
                    const senderName = email.sender.replace(/<[^>]+>/, '').trim() || senderEmail
                    await api.addAutopilotRule({ email_addr: senderEmail, display_name: senderName, mode: 'draft' })
                  } catch {}
                }}
                title="Add sender to Email Autopilot (saves as draft)"
                className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 text-sm text-gray-400 hover:text-blue-600 w-6 h-6 flex items-center justify-center rounded-full hover:bg-blue-50 transition-all z-10"
              >
                🤖
              </button>

              {/* Hover AI thread-summary card — floats near cursor, flips above if near bottom */}
              {hoveredId === email.id && selectedId !== email.id && (() => {
                const flip = hoverPos.y > window.innerHeight - 180
                return (
                  <div
                    className="fixed z-50 bg-white border border-gray-200 text-gray-700 text-xs rounded-xl px-3 py-3 shadow-lg pointer-events-none max-w-xs"
                    style={{
                      left: Math.min(hoverPos.x + 14, window.innerWidth - 280),
                      ...(flip ? { bottom: window.innerHeight - hoverPos.y + 14 } : { top: hoverPos.y + 14 }),
                    }}
                  >
                    <p className="font-semibold text-gray-800 truncate mb-1">
                      {email.subject || '(no subject)'}
                    </p>
                    {hoverSummary[email.id] ? (
                      <p className="text-gray-600 leading-relaxed">{hoverSummary[email.id]}</p>
                    ) : hoverLoading ? (
                      <p className="flex items-center gap-1.5 text-gray-400">
                        <span className="w-3 h-3 border border-gray-300 border-t-accent rounded-full animate-spin inline-block" />
                        Summarizing thread…
                      </p>
                    ) : (
                      <p className="text-gray-400 line-clamp-3">{(email.preview || '').slice(0, 140)}</p>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })}

        <div ref={sentinelRef} className="h-4" />
        {loading && (
          <div className="text-center text-gray-400 text-xs py-3">Loading…</div>
        )}
      </div>
      <InboxSprint open={showSprint} onClose={() => setShowSprint(false)} onChanged={() => onSearch(query)} />
    </div>
  )
}
