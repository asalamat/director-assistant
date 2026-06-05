import { useState, useEffect, useRef, useMemo } from 'react'
import { api } from '../api/client'
import type { Person, Cluster, OpenLoop, TimelineEvent } from '../types'

type SubTab = 'briefing' | 'people' | 'loops' | 'projects' | 'timeline'

const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
  { id: 'briefing', label: 'Role Briefing', icon: '🧭' },
  { id: 'people',   label: 'People',        icon: '👥' },
  { id: 'loops',    label: 'Open Loops',    icon: '🔄' },
  { id: 'projects', label: 'Projects',      icon: '📁' },
  { id: 'timeline', label: 'Timeline',      icon: '📅' },
]

// ── Briefing ──────────────────────────────────────────────────────────────────

function BriefingTab() {
  const [status, setStatus] = useState('')
  const [summary, setSummary] = useState('')
  const [people, setPeople] = useState<string[]>([])
  const [projects, setProjects] = useState<Cluster[]>([])
  const [loops, setLoops] = useState<OpenLoop[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)

  // Features 6 + 9: auto-run on first daily visit
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem('lastBriefingDate') !== today) {
      localStorage.setItem('lastBriefingDate', today)
      handleGenerate()
    }
  }, [])

  const handleGenerate = () => {
    setPeople([]); setProjects([]); setLoops([]); setSummary('')
    setDone(false); setRunning(true)
    setStatus('Starting analysis…')

    stopRef.current = api.streamBriefing((section, content) => {
      if (section === 'status') setStatus(content as string)
      else if (section === 'people') setPeople(content as string[])
      else if (section === 'projects') setProjects(content as Cluster[])
      else if (section === 'loops') setLoops(content as OpenLoop[])
      else if (section === 'summary') { setSummary(content as string); setStatus('') }
      else if (section === 'done') { setRunning(false); setDone(true); setStatus('') }
      else if (section === 'error') { setStatus('Error: ' + content); setRunning(false) }
    })
  }

  const urgencyColor = (u: string) =>
    u === 'high' ? 'text-red-600 bg-red-50 border-red-200' :
    u === 'medium' ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-gray-600 bg-gray-50 border-gray-200'

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Role Transition Briefing</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            AI analysis of your email corpus — understand the state of affairs, key relationships, and open items.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={running}
          className="flex-shrink-0 px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
        >
          {running ? (
            <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" /> Analyzing…</>
          ) : (
            <>{done ? 'Regenerate' : 'Brief me on this role'}</>
          )}
        </button>
      </div>

      {status && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-accent rounded-full animate-spin flex-shrink-0" />
          {status}
        </div>
      )}

      {summary && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-blue-800 mb-3">Executive Summary</h3>
          <div className="text-sm text-blue-900 whitespace-pre-line leading-relaxed">{summary}</div>
        </div>
      )}

      {people.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Key Relationships</h3>
          <div className="space-y-1">
            {people.map((p, i) => (
              <div key={i} className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 font-mono">
                {p}
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Active Projects</h3>
          <div className="grid grid-cols-2 gap-2">
            {projects.filter(c => c.status === 'active').slice(0, 6).map((c) => (
              <div key={c.id} className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-medium text-gray-800">{c.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{c.status}</span>
                </div>
                <p className="text-xs text-gray-500">{c.description}</p>
                <p className="text-[10px] text-gray-400 mt-1">{c.email_count} emails · {c.last_activity?.slice(0,10)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {loops.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Open Commitments ({loops.length})</h3>
          <div className="space-y-1.5">
            {loops.slice(0, 8).map((l, i) => (
              <div key={i} className={`flex items-start gap-2 border rounded-lg px-3 py-2 text-xs ${urgencyColor(l.urgency)}`}>
                <span className="font-medium capitalize flex-shrink-0">{l.type}</span>
                <span className="flex-1">{l.text}</span>
                <span className="flex-shrink-0 text-[10px] opacity-70">{l.date?.slice(0,10)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!running && !done && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">🧭</div>
          <p className="text-sm">Click "Brief me on this role" to generate an AI-powered analysis of your email corpus.</p>
          <p className="text-xs mt-1">Covers active projects, key relationships, and open commitments.</p>
        </div>
      )}
    </div>
  )
}

// ── Network Graph ─────────────────────────────────────────────────────────────

function NetworkGraph({ people }: { people: Person[] }) {
  const W = 420, H = 260

  const nodes = useMemo(() => {
    const subset = people.slice(0, 18)
    return subset.map((p, i) => {
      const angle = (i / subset.length) * Math.PI * 2 - Math.PI / 2
      const radius = 95
      return {
        ...p,
        x: W / 2 + Math.cos(angle) * radius,
        y: H / 2 + Math.sin(angle) * radius,
        r: Math.max(6, Math.min(20, Math.sqrt((p.received_count + p.sent_count) || 1) * 2.5)),
      }
    })
  }, [people])

  // Draw edges between adjacent nodes (visual connectivity)
  const edges: [number, number][] = useMemo(() => {
    const e: [number, number][] = []
    for (let i = 0; i < nodes.length; i++) {
      e.push([i, (i + 1) % nodes.length])
      if (nodes.length > 6 && i % 3 === 0) e.push([i, (i + Math.floor(nodes.length / 3)) % nodes.length])
    }
    return e
  }, [nodes])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {edges.map(([a, b], i) => (
        <line key={i}
          x1={nodes[a].x} y1={nodes[a].y}
          x2={nodes[b].x} y2={nodes[b].y}
          stroke="#e5e7eb" strokeWidth="1"
        />
      ))}
      {nodes.map((n, i) => (
        <g key={n.email}>
          <circle
            cx={n.x} cy={n.y} r={n.r}
            fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5"
            style={{ animationDelay: `${i * 30}ms` }}
            className="animate-pop"
          />
          <text x={n.x} y={n.y + n.r + 9}
            textAnchor="middle" fontSize="7" fill="#6b7280"
            className="select-none pointer-events-none">
            {n.name.split(' ')[0]}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ── People ────────────────────────────────────────────────────────────────────

function PeopleTab() {
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'score' | 'received' | 'sent' | 'recent'>('score')
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')

  useEffect(() => {
    api.getPeople(100).then(r => setPeople(r.people)).catch(() => setPeople([])).finally(() => setLoading(false))
  }, [])

  const filtered = people
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'received') return b.received_count - a.received_count
      if (sort === 'sent') return b.sent_count - a.sent_count
      if (sort === 'recent') return (b.last_contact || '').localeCompare(a.last_contact || '')
      return b.score - a.score
    })

  const exportCSV = () => {
    const rows = [
      ['name', 'email', 'received', 'sent', 'score', 'last_contact'],
      ...filtered.map(p => [`"${p.name.replace(/"/g, '""')}"`, p.email, p.received_count, p.sent_count, p.score, p.last_contact || ''])
    ]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }))
    a.download = 'contacts.csv'
    a.click()
  }

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex gap-2 flex-shrink-0">
        {viewMode === 'list' && (
          <>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
            <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 focus:outline-none">
              <option value="score">By relevance</option>
              <option value="received">Most received</option>
              <option value="sent">Most sent</option>
              <option value="recent">Most recent</option>
            </select>
            {filtered.length > 0 && (
              <button onClick={exportCSV} title="Export contacts to CSV"
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-500 hover:bg-gray-50 flex-shrink-0">CSV</button>
            )}
          </>
        )}
        {viewMode === 'graph' && <p className="flex-1 text-xs text-gray-400 py-1.5">Top 18 contacts by email volume</p>}
        <div className="flex border border-gray-200 rounded-lg overflow-hidden flex-shrink-0">
          <button
            onClick={() => setViewMode('list')}
            className={`px-2.5 py-1.5 text-xs transition-colors ${viewMode === 'list' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            title="List view"
          >
            ☰
          </button>
          <button
            onClick={() => setViewMode('graph')}
            className={`px-2.5 py-1.5 text-xs transition-colors ${viewMode === 'graph' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            title="Network view"
          >
            ◎
          </button>
        </div>
      </div>

      {viewMode === 'graph' ? (
        <div className="flex-1 overflow-hidden px-4 pb-4">
          {people.length === 0
            ? <p className="text-sm text-gray-400 text-center py-8">No contacts found</p>
            : <NetworkGraph people={people} />
          }
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No contacts found</p>}
          {filtered.map(p => (
            <div key={p.email} className="border border-gray-100 rounded-xl p-3 hover:border-gray-200 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-accent/10 text-accent text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400 truncate">{p.email}</p>
                    </div>
                  </div>
                  {p.subjects.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1.5 ml-9 truncate">{p.subjects[0]}</p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="flex gap-2 text-xs text-gray-500">
                    <span title="Received">{p.received_count} in</span>
                    <span title="Sent">{p.sent_count} out</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{p.last_contact?.slice(0, 10)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Open Loops ────────────────────────────────────────────────────────────────

const DISMISSED_KEY = 'dismissed_loops'

function loopFingerprint(l: OpenLoop): string {
  return `${l.type}|${l.sender}|${(l.date || '').slice(0, 10)}|${(l.text || '').slice(0, 60)}`
}

function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) }
  catch { return new Set() }
}

function saveDismissed(s: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s]))
}

function LoopsTab() {
  const [loops, setLoops] = useState<OpenLoop[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState<'all' | 'commitment' | 'awaiting' | 'deadline'>('all')
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)
  const [showDismissed, setShowDismissed] = useState(false)

  const load = () => {
    setLoading(true)
    api.getOpenLoops()
      .then(r => { setLoops(r.loops); setLoaded(true) })
      .catch(() => setLoops([]))
      .finally(() => setLoading(false))
  }

  // Auto-refresh every 30 min after initial load
  useEffect(() => {
    if (!loaded) return
    const id = setInterval(load, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [loaded])

  const dismiss = (loop: OpenLoop) => {
    const next = new Set(dismissed)
    next.add(loopFingerprint(loop))
    setDismissed(next)
    saveDismissed(next)
  }

  const restore = (loop: OpenLoop) => {
    const next = new Set(dismissed)
    next.delete(loopFingerprint(loop))
    setDismissed(next)
    saveDismissed(next)
  }

  const clearAllDismissed = () => {
    setDismissed(new Set())
    saveDismissed(new Set())
    setShowDismissed(false)
  }

  const active = loops.filter(l => !dismissed.has(loopFingerprint(l)))
  const dismissedLoops = loops.filter(l => dismissed.has(loopFingerprint(l)))

  const exportCSV = () => {
    const rows = [
      ['type', 'urgency', 'text', 'sender', 'date'],
      ...active.map(l => [l.type, l.urgency, `"${(l.text || '').replace(/"/g, '""')}"`, `"${(l.sender || '').replace(/"/g, '""')}"`, l.date || ''])
    ]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }))
    a.download = 'open_loops.csv'
    a.click()
  }

  const filtered = filter === 'all' ? active : active.filter(l => l.type === filter)
  const filteredDismissed = filter === 'all' ? dismissedLoops : dismissedLoops.filter(l => l.type === filter)
  const high = filtered.filter(l => l.urgency === 'high')
  const medium = filtered.filter(l => l.urgency === 'medium')
  const low = filtered.filter(l => l.urgency === 'low')

  const urgencyStyle = (u: string) =>
    u === 'high' ? 'border-red-200 bg-red-50' :
    u === 'medium' ? 'border-amber-200 bg-amber-50' :
    'border-gray-100 bg-white'

  const badgeStyle = (u: string) =>
    u === 'high' ? 'bg-red-100 text-red-700' :
    u === 'medium' ? 'bg-amber-100 text-amber-700' :
    'bg-gray-100 text-gray-500'

  const typeIcon = (t: string) => t === 'commitment' ? '📌' : t === 'awaiting' ? '⏳' : '⚡'

  if (!loaded && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
        <div className="text-4xl">🔄</div>
        <div className="text-center">
          <p className="text-sm text-gray-600 font-medium">Scan for open commitments</p>
          <p className="text-xs text-gray-400 mt-1">AI will scan your recent emails for unresolved items, awaited responses, and deadlines.</p>
        </div>
        <button onClick={load} className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-blue-700 transition-colors">
          Scan emails
        </button>
      </div>
    )
  }

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
        <div className="flex gap-1 flex-wrap">
          {(['all', 'commitment', 'awaiting', 'deadline'] as const).map(f => {
            const activeCount = f === 'all' ? active.length : active.filter(l => l.type === f).length
            const dismissedCount = f === 'all' ? dismissedLoops.length : dismissedLoops.filter(l => l.type === f).length
            const total = showDismissed ? activeCount + dismissedCount : activeCount
            return (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === f ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                {f === 'all' ? `All (${total})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${total})`}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1">
          {dismissedLoops.length > 0 && (
            <button onClick={() => setShowDismissed(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">
              {showDismissed ? 'Hide' : `Dismissed (${dismissedLoops.length})`}
            </button>
          )}
          {active.length > 0 && (
            <button onClick={exportCSV} title="Export to CSV"
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">CSV</button>
          )}
          <button onClick={load} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100">Refresh</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {filtered.length === 0 && filteredDismissed.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No open items found</p>
        )}
        {filtered.length === 0 && filteredDismissed.length > 0 && !showDismissed && (
          <p className="text-sm text-gray-400 text-center py-8">
            All items are resolved — click <span className="font-medium">Dismissed ({filteredDismissed.length})</span> to view
          </p>
        )}
        {[...high, ...medium, ...low].map((loop, i) => (
          <div key={i} className={`border rounded-xl p-3 ${urgencyStyle(loop.urgency)}`}>
            <div className="flex items-start gap-2">
              <span className="text-base flex-shrink-0 mt-0.5">{typeIcon(loop.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{loop.text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-500 truncate">{loop.sender}</span>
                  <span className="text-xs text-gray-400">{loop.date?.slice(0, 10)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeStyle(loop.urgency)}`}>{loop.urgency}</span>
                  <span className="text-[10px] text-gray-400">{loop.type}</span>
                </div>
              </div>
              <button
                onClick={() => dismiss(loop)}
                title="Mark as resolved"
                className="flex-shrink-0 text-gray-300 hover:text-green-500 transition-colors p-1 rounded hover:bg-white/60"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
              </button>
            </div>
          </div>
        ))}

        {showDismissed && filteredDismissed.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Resolved / Dismissed ({filteredDismissed.length})
              </p>
              <button onClick={clearAllDismissed} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Clear all</button>
            </div>
            {filteredDismissed.map((loop, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 bg-gray-50 opacity-60 mb-2">
                <div className="flex items-start gap-2">
                  <span className="text-base flex-shrink-0 mt-0.5 grayscale">{typeIcon(loop.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-500 line-through">{loop.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400 truncate">{loop.sender}</span>
                      <span className="text-xs text-gray-300">{loop.date?.slice(0, 10)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => restore(loop)}
                    title="Restore"
                    className="flex-shrink-0 text-gray-300 hover:text-accent transition-colors p-1 rounded hover:bg-white"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clipRule="evenodd"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Projects ──────────────────────────────────────────────────────────────────

interface ProjectsTabProps {
  onSelectCluster: (cluster: Cluster) => void
}

function ProjectsTab({ onSelectCluster }: ProjectsTabProps) {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'active' | 'dormant' | 'resolved'>('all')

  useEffect(() => {
    api.getClusters().then(r => setClusters(r.clusters)).catch(() => setClusters([])).finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'all' ? clusters : clusters.filter(c => c.status === filter)

  const statusStyle = (s: string) =>
    s === 'active' ? 'bg-green-100 text-green-700' :
    s === 'dormant' ? 'bg-amber-100 text-amber-700' :
    'bg-gray-100 text-gray-500'

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex gap-1 flex-shrink-0">
        {(['all', 'active', 'dormant', 'resolved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === f ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'all' ? ` (${clusters.length})` : ` (${clusters.filter(c => c.status === f).length})`}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No clusters found — try generating a briefing first</p>}
        <div className="grid grid-cols-2 gap-3 pt-2">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => onSelectCluster(c)}
              className="text-left border border-gray-200 rounded-xl p-4 hover:border-accent hover:bg-blue-50/30 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-800 group-hover:text-accent transition-colors">{c.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusStyle(c.status)}`}>{c.status}</span>
              </div>
              <p className="text-xs text-gray-500 mb-2 leading-relaxed">{c.description}</p>
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span>{c.email_count} emails</span>
                <span>{c.last_activity?.slice(0, 10)}</span>
              </div>
              {c.keywords?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {c.keywords.slice(0, 3).map(kw => (
                    <span key={kw} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{kw}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Timeline ──────────────────────────────────────────────────────────────────

interface TimelineTabProps {
  initialQuery?: string
}

function TimelineTab({ initialQuery = '' }: TimelineTabProps) {
  const [query, setQuery] = useState(initialQuery)
  const [inputVal, setInputVal] = useState(initialQuery)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (initialQuery) {
      setInputVal(initialQuery)
      setQuery(initialQuery)
    }
  }, [initialQuery])

  useEffect(() => {
    if (!query.trim()) return
    setLoading(true)
    api.getTimeline(query).then(r => setEvents(r.events)).catch(() => setEvents([])).finally(() => setLoading(false))
  }, [query])

  const search = () => setQuery(inputVal.trim())

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex gap-2 flex-shrink-0">
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Search topic or project… (e.g. 'budget Q4' or 'hiring')"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
        />
        <button onClick={search} disabled={!inputVal.trim() || loading}
          className="px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {loading ? '…' : 'View'}
        </button>
      </div>

      {loading && <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}

      {!loading && events.length === 0 && !query && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-sm">Search a topic to see its chronological history</p>
          <p className="text-xs mt-1">e.g. "contract renewal", "Q4 budget", "new hire"</p>
        </div>
      )}

      {!loading && events.length === 0 && query && (
        <p className="text-sm text-gray-400 text-center py-8">No emails found for "{query}"</p>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {events.length > 0 && (
          <div className="relative pt-2">
            <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-200" />
            <div className="space-y-3">
              {events.map((ev, i) => (
                <div key={ev.id ?? i} className="relative pl-9">
                  <div className="absolute left-2.5 top-2 w-2 h-2 rounded-full bg-accent border-2 border-white" />
                  <div className="border border-gray-100 rounded-xl p-3 hover:border-gray-200 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-gray-800 leading-tight">{ev.subject}</p>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{ev.date?.slice(0, 10)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-1">{ev.sender}</p>
                    {ev.snippet && <p className="text-xs text-gray-400 truncate">{ev.snippet}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function IntelligencePanel() {
  const [activeTab, setActiveTab] = useState<SubTab>('briefing')
  const [timelineQuery, setTimelineQuery] = useState('')

  const handleSelectCluster = (cluster: Cluster) => {
    setTimelineQuery(cluster.keywords?.[0] || cluster.name)
    setActiveTab('timeline')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50 px-2 flex-shrink-0">
        {SUB_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'border-accent text-accent bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === 'briefing'  && <div className="h-full overflow-y-auto min-h-0"><BriefingTab /></div>}
        {activeTab === 'people'    && <PeopleTab />}
        {activeTab === 'loops'     && <LoopsTab />}
        {activeTab === 'projects'  && <ProjectsTab onSelectCluster={handleSelectCluster} />}
        {activeTab === 'timeline'  && <TimelineTab initialQuery={timelineQuery} />}
      </div>
    </div>
  )
}
