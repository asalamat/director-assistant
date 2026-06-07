import { useState, useCallback } from 'react'
import { api } from '../api/client'
import { LoadingOverlay, EmptyState, Button, Badge } from './ui'

interface SourceEmail {
  id: string; subject: string; sender: string; date: string; folder: string
}
interface BriefItem {
  text: string; emails: SourceEmail[]
}
interface Brief {
  period?: string; since?: string; generated_at?: string
  total_received?: number; total_sent?: number; summary?: string
  action_items?: BriefItem[]
  commitments_made?: BriefItem[]
  waiting_for?: BriefItem[]
  upcoming_deadlines?: BriefItem[]
  key_decisions?: BriefItem[]
  wins?: BriefItem[]
  relationships_to_nurture?: BriefItem[]
  error?: string
}

interface SearchResult { email_id?: string; id?: string; subject: string; sender: string; date?: string; text?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' }) }
  catch { return d.slice(0, 10) }
}

function extractKeyword(text: string): string {
  // Pull out the most useful search term from a brief item
  const cleaned = text.replace(/["""'']/g, '')
  const match = cleaned.match(/(?:from|with|at|regarding|about|for|on)\s+([A-Z][a-zA-Z\s&]+?)(?:\s*[-–—,.(]|$)/)
  if (match) return match[1].trim()
  // Fall back to first 4 words
  return cleaned.split(/\s+/).slice(0, 4).join(' ')
}

// ── Source email chip ─────────────────────────────────────────────────────────

function EmailChip({ email, onSelect }: { email: SourceEmail; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(email.id)}
      className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs hover:border-accent hover:bg-blue-50 transition-colors group max-w-full"
      title={`${email.sender} · ${email.subject}`}
    >
      <svg className="w-3 h-3 text-gray-300 group-hover:text-accent flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/>
        <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/>
      </svg>
      <span className="truncate text-gray-600 group-hover:text-accent max-w-[160px]">{email.subject || '(no subject)'}</span>
      <span className="text-gray-300 flex-shrink-0">{fmtDate(email.date)}</span>
    </button>
  )
}

// ── Brief item row ────────────────────────────────────────────────────────────

function BriefItemRow({
  item, onSelectEmail, onSearch
}: {
  item: BriefItem
  onSelectEmail: (id: string) => void
  onSearch: (q: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  const findRelated = async () => {
    if (searchResults) { setExpanded(v => !v); return }
    setExpanded(true)
    setSearching(true)
    try {
      const r = await api.searchBriefItem(extractKeyword(item.text))
      setSearchResults(r.emails)
    } catch { setSearchResults([]) }
    setSearching(false)
  }

  const allEmails: { id: string; subject: string; sender: string; date?: string }[] = [
    ...(item.emails || []),
    ...(expanded && searchResults
      ? searchResults
          .filter(e => !(item.emails || []).some(s => s.id === (e.email_id || e.id)))
          .map(e => ({ id: e.email_id || e.id || '', subject: e.subject, sender: e.sender, date: e.date }))
      : []),
  ]

  return (
    <div className="group py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex items-start gap-2">
        <span className="text-gray-300 mt-0.5 flex-shrink-0">•</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-700 leading-relaxed">{item.text}</p>

          {/* Source email chips */}
          {(item.emails?.length > 0 || expanded) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {item.emails?.map(e => (
                <EmailChip key={e.id} email={e} onSelect={onSelectEmail} />
              ))}
              {searching && <span className="text-xs text-gray-400 animate-pulse self-center">Finding related…</span>}
              {expanded && searchResults && searchResults.length === 0 && item.emails?.length === 0 && (
                <span className="text-xs text-gray-400">No related emails found</span>
              )}
              {expanded && searchResults && searchResults
                .filter(e => !(item.emails || []).some(s => s.id === (e.email_id || e.id)))
                .map((e, i) => (
                  <EmailChip
                    key={i}
                    email={{ id: e.email_id || e.id || '', subject: e.subject, sender: e.sender, date: e.date || '', folder: '' }}
                    onSelect={onSelectEmail}
                  />
                ))}
            </div>
          )}
        </div>

        {/* Find emails button */}
        <button
          onClick={findRelated}
          title="Find related emails"
          className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 ${
            expanded ? 'text-accent bg-blue-50' : 'text-gray-400 hover:text-accent hover:bg-blue-50'
          }`}
        >
          {expanded ? 'hide' : '🔍'}
        </button>
      </div>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  icon, title, items, color, onSelectEmail, onSearch, defaultOpen = false
}: {
  icon: string; title: string; items?: BriefItem[]; color: string
  onSelectEmail: (id: string) => void; onSearch: (q: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!items || items.length === 0) return null
  const emailCount = items.reduce((acc, it) => acc + (it.emails?.length || 0), 0)

  return (
    <div className="mb-3 border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <span className={`text-xs font-semibold uppercase tracking-wide ${color}`}>{title}</span>
          <Badge variant="default">{items.length}</Badge>
          {emailCount > 0 && (
            <Badge variant="info">{emailCount} email{emailCount > 1 ? 's' : ''}</Badge>
          )}
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && (
        <div className="px-4 py-1">
          {items.map((item, i) => (
            <BriefItemRow key={i} item={item} onSelectEmail={onSelectEmail} onSearch={onSearch} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function WeeklyBriefPanel({
  onSelectEmail,
  onSearch,
}: {
  onSelectEmail?: (emailId: string) => void
  onSearch?: (q: string) => void
}) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [loading, setLoading] = useState(false)

  const generate = async (force = false) => {
    if (force) await api.clearWeeklyBriefCache().catch(() => {})
    setLoading(true)
    try {
      const data = await api.getWeeklyBrief()
      setBrief(data)
    } catch { setBrief({ error: 'Failed to generate brief. Check your API key in Settings.' }) }
    setLoading(false)
  }

  const handleSelectEmail = useCallback((id: string) => {
    onSelectEmail?.(id)
  }, [onSelectEmail])

  const handleSearch = useCallback((q: string) => {
    onSearch?.(q)
  }, [onSearch])

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!brief && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <EmptyState
          icon="📊"
          title="Weekly Executive Brief"
          description="AI analyses your past 7 days — decisions, commitments, what you're waiting for, wins, and top action items. Each item links to the source emails so you can drill in with one click."
          action={<Button variant="primary" size="sm" onClick={() => generate()}>Generate this week's brief</Button>}
        />
      </div>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <LoadingOverlay text="Analysing your past 7 days…" />
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (brief?.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <EmptyState
          icon="⚠️"
          title="Brief generation failed"
          description={brief.error}
          action={<Button variant="ghost" size="sm" onClick={() => generate(true)}>Try again</Button>}
        />
      </div>
    )
  }

  // ── Brief ──────────────────────────────────────────────────────────────────
  const totalActionEmails = (brief?.action_items || []).reduce((a, i) => a + (i.emails?.length || 0), 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Weekly Executive Brief</h2>
            <p className="text-xs text-gray-400 mt-0.5">{brief?.period || brief?.since}</p>
          </div>
          <button onClick={() => generate(true)} title="Regenerate"
            className="text-xs text-gray-400 hover:text-accent px-2 py-1 rounded hover:bg-blue-50 transition-colors flex items-center gap-1">
            ↺ Refresh
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Received', value: brief?.total_received ?? '—' },
            { label: 'Sent', value: brief?.total_sent ?? '—' },
            { label: 'Actions', value: brief?.action_items?.length ?? 0 },
            { label: 'Linked emails', value: totalActionEmails },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-gray-800">{value}</p>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Summary */}
        {brief?.summary && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4 mb-4 shadow-card">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1.5">This week's overview</p>
            <p className="text-sm text-blue-900 leading-relaxed">{brief.summary}</p>
          </div>
        )}

        <p className="text-[10px] text-gray-400 mb-3 flex items-center gap-1">
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/></svg>
          Click any section to expand · Hover an item and click 🔍 to find related emails · Click an email chip to open it
        </p>

        <Section icon="🎯" title="Top Action Items" items={brief?.action_items} color="text-red-600"
          onSelectEmail={handleSelectEmail} onSearch={handleSearch} defaultOpen={true} />
        <Section icon="⏳" title="Waiting For" items={brief?.waiting_for} color="text-amber-600"
          onSelectEmail={handleSelectEmail} onSearch={handleSearch} defaultOpen={true} />
        <Section icon="📋" title="Commitments Made" items={brief?.commitments_made} color="text-orange-600"
          onSelectEmail={handleSelectEmail} onSearch={handleSearch} />
        <Section icon="⚡" title="Upcoming Deadlines" items={brief?.upcoming_deadlines} color="text-red-500"
          onSelectEmail={handleSelectEmail} onSearch={handleSearch} />
        <Section icon="✅" title="Decisions Made" items={brief?.key_decisions} color="text-green-600"
          onSelectEmail={handleSelectEmail} onSearch={handleSearch} />
        <Section icon="🏆" title="Wins This Week" items={brief?.wins} color="text-emerald-600"
          onSelectEmail={handleSelectEmail} onSearch={handleSearch} />
        <Section icon="🤝" title="Relationships to Nurture" items={brief?.relationships_to_nurture} color="text-purple-600"
          onSelectEmail={handleSelectEmail} onSearch={handleSearch} />

        {brief?.generated_at && (
          <p className="text-[10px] text-gray-300 mt-4 text-right">
            Generated {new Date(brief.generated_at).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  )
}
