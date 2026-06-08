import { useState, useEffect, useMemo } from 'react'
import { api } from '../../api/client'
import type { Person } from '../../types'

export function NetworkGraph({ people }: { people: Person[] }) {
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

export function PeopleTab() {
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
