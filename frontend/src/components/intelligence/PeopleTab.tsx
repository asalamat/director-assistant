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
  // VIP sync: email_addr → vip row id (undefined = not a VIP)
  const [vipMap, setVipMap] = useState<Record<string, number>>({})
  const [toggling, setToggling] = useState<string | null>(null)
  const [hints, setHints] = useState<Record<string, { phones: string[]; sources: string[] }>>({})
  const [importMsg, setImportMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [dupeCount, setDupeCount] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)

  const refreshHints = () =>
    api.getContactHints().then(r => setHints(r.hints)).catch(() => {})

  const hideContact = async (email: string) => {
    const key = email.toLowerCase()
    setHidden(prev => new Set([...prev, key]))
    try { await api.hideContact(key) } catch { setHidden(prev => { const n = new Set(prev); n.delete(key); return n }) }
  }

  const unhideContact = async (email: string) => {
    const key = email.toLowerCase()
    setHidden(prev => { const n = new Set(prev); n.delete(key); return n })
    try { await api.unhideContact(key) } catch { setHidden(prev => new Set([...prev, key])) }
  }

  const checkDuplicates = () =>
    api.findContactDuplicates().then(r => setDupeCount(r.total_groups)).catch(() => {})

  const handleMergeDuplicates = async () => {
    setImporting(true)
    setImportMsg('')
    try {
      const r = await api.mergeContactDuplicates()
      setImportMsg(`✓ ${r.message}`)
      setDupeCount(0)
      if (r.records_removed > 0) refreshHints()
    } catch (err: any) {
      setImportMsg(`✗ ${err.message || 'Merge failed'}`)
    }
    setImporting(false)
    setTimeout(() => setImportMsg(''), 5000)
  }

  useEffect(() => {
    Promise.all([
      api.getPeople(100),
      api.getVIPs(),
      api.getContactHints(),
      api.listHiddenContacts(),
    ]).then(([peopleRes, vipRes, hintsRes, hiddenRes]) => {
      setPeople(peopleRes.people)
      const map: Record<string, number> = {}
      for (const v of vipRes.vips) map[v.email_addr.toLowerCase()] = v.id
      setVipMap(map)
      setHints(hintsRes.hints)
      setHidden(new Set(hiddenRes.hidden.map((h: any) => h.email_addr.toLowerCase())))
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const handleVCardImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setImportMsg('')
    try {
      const r = await api.importContacts(file)
      setImportMsg(`✓ ${r.message}`)
      if (r.imported > 0) refreshHints()
    } catch (err: any) {
      setImportMsg(`✗ ${err.message || 'Import failed'}`)
    }
    setImporting(false)
    setTimeout(() => setImportMsg(''), 5000)
  }

  const handleSyncProvider = async () => {
    setImporting(true)
    setImportMsg('')
    try {
      const r = await api.syncContactsFromProvider()
      setImportMsg(`${r.success ? '✓' : '✗'} ${r.message}`)
      if (r.imported > 0) refreshHints()
    } catch (err: any) {
      setImportMsg(`✗ ${err.message || 'Sync failed'}`)
    }
    setImporting(false)
    setTimeout(() => setImportMsg(''), 6000)
  }

  const toggleVIP = async (p: Person) => {
    const key = p.email.toLowerCase()
    if (toggling === key) return
    setToggling(key)
    try {
      if (vipMap[key] !== undefined) {
        await api.removeVIP(vipMap[key])
        setVipMap(prev => { const n = { ...prev }; delete n[key]; return n })
      } else {
        const r = await api.addVIP({ email_addr: p.email, name: p.name, note: '' })
        // Re-fetch VIPs to get the new id
        const vipRes = await api.getVIPs()
        const map: Record<string, number> = {}
        for (const v of vipRes.vips) map[v.email_addr.toLowerCase()] = v.id
        setVipMap(map)
      }
    } catch { /* silent */ }
    setToggling(null)
  }

  const visiblePeople = showHidden ? people : people.filter(p => !hidden.has(p.email.toLowerCase()))
  const filtered = visiblePeople
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'received') return b.received_count - a.received_count
      if (sort === 'sent') return b.sent_count - a.sent_count
      if (sort === 'recent') return (b.last_contact || '').localeCompare(a.last_contact || '')
      return b.score - a.score
    })

  const exportCSV = () => {
    const rows = [
      ['name', 'email', 'received', 'sent', 'score', 'last_contact', 'vip'],
      ...filtered.map(p => [
        `"${p.name.replace(/"/g, '""')}"`, p.email,
        p.received_count, p.sent_count, p.score, p.last_contact || '',
        vipMap[p.email.toLowerCase()] !== undefined ? 'yes' : 'no',
      ])
    ]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }))
    a.download = 'contacts.csv'
    a.click()
  }

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  const vipCount = Object.keys(vipMap).length

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
            <label
              title="Import contacts from .vcf or .csv file — no duplicates"
              className={`text-xs border border-gray-200 rounded-lg px-2 py-1.5 cursor-pointer flex-shrink-0 transition-colors ${importing ? 'opacity-50 pointer-events-none text-gray-400' : 'text-gray-500 hover:bg-gray-50 hover:border-accent'}`}
            >
              {importing ? '…' : '📥 File'}
              <input type="file" accept=".vcf,.csv" className="hidden" onChange={handleVCardImport} disabled={importing} />
            </label>
            <button
              onClick={handleSyncProvider}
              disabled={importing}
              title="Auto-sync from Microsoft 365 contacts"
              className={`text-xs border border-gray-200 rounded-lg px-2 py-1.5 flex-shrink-0 transition-colors ${importing ? 'opacity-50 text-gray-400' : 'text-gray-500 hover:bg-gray-50 hover:border-accent'}`}
            >
              {importing ? '…' : '☁️ Sync'}
            </button>
            <a
              href={api.exportVCard()}
              download="director-assistant-contacts.vcf"
              title="Export all contacts as vCard (.vcf)"
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-500 hover:bg-gray-50 hover:border-accent flex-shrink-0 transition-colors"
            >
              📤 Export
            </a>
            {dupeCount === null ? (
              <button
                onClick={checkDuplicates}
                disabled={importing}
                title="Find duplicate contacts with the same name"
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-500 hover:bg-gray-50 hover:border-amber-300 flex-shrink-0 transition-colors disabled:opacity-50"
              >
                🔍 Dupes
              </button>
            ) : dupeCount > 0 ? (
              <button
                onClick={handleMergeDuplicates}
                disabled={importing}
                title={`${dupeCount} duplicate group${dupeCount !== 1 ? 's' : ''} found — click to merge`}
                className="text-xs border border-amber-300 bg-amber-50 rounded-lg px-2 py-1.5 text-amber-700 hover:bg-amber-100 flex-shrink-0 transition-colors disabled:opacity-50 font-medium"
              >
                ⚡ Merge {dupeCount} dupe{dupeCount !== 1 ? 's' : ''}
              </button>
            ) : (
              <span className="text-xs text-green-600 flex-shrink-0">✓ No dupes</span>
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

      {importMsg && (
        <p className={`px-4 pb-1 text-[10px] font-medium flex-shrink-0 ${importMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
          {importMsg}
        </p>
      )}
      {hidden.size > 0 && (
        <p className="px-4 pb-1 text-[10px] text-gray-400 flex-shrink-0 flex items-center gap-2">
          {hidden.size} hidden — <button onClick={() => setShowHidden(v => !v)} className="underline hover:text-gray-600">{showHidden ? 'hide again' : 'show'}</button>
        </p>
      )}
      {viewMode === 'list' && vipCount > 0 && (
        <p className="px-4 pb-1 text-[10px] text-amber-500 font-medium flex-shrink-0">
          ★ {vipCount} VIP contact{vipCount !== 1 ? 's' : ''} — click star to toggle
        </p>
      )}

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
          {filtered.map(p => {
            const isVIP = vipMap[p.email.toLowerCase()] !== undefined
            const isToggling = toggling === p.email.toLowerCase()
            return (
              <div key={p.email} className={`border rounded-xl p-3 transition-colors ${isVIP ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${isVIP ? 'bg-amber-100 text-amber-600' : 'bg-accent/10 text-accent'}`}>
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                          {isVIP && <span className="text-[10px] text-amber-500 font-semibold flex-shrink-0">VIP</span>}
                        </div>
                        <p className="text-xs text-gray-400 truncate">{p.email}</p>
                      </div>
                    </div>
                    {p.subjects.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1.5 ml-9 truncate">{p.subjects[0]}</p>
                    )}
                    {hints[p.email.toLowerCase()]?.phones?.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-1.5 ml-9 flex-wrap">
                        {hints[p.email.toLowerCase()].phones.slice(0, 2).map((ph, i) => (
                          <a key={i} href={`tel:${ph.replace(/\s/g, '')}`}
                            className="text-[10px] text-blue-500 hover:text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 font-mono"
                            onClick={e => e.stopPropagation()}>
                            📞 {ph}
                          </a>
                        ))}
                        {hints[p.email.toLowerCase()].sources.includes('microsoft') && (
                          <span className="text-[9px] text-gray-300 italic">from contacts</span>
                        )}
                        {hints[p.email.toLowerCase()].sources.includes('document') && (
                          <span className="text-[9px] text-gray-300 italic">from docs</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-2 flex-shrink-0">
                    <div className="text-right">
                      <div className="flex gap-2 text-xs text-gray-500">
                        <span title="Received">{p.received_count} in</span>
                        <span title="Sent">{p.sent_count} out</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{p.last_contact?.slice(0, 10)}</p>
                    </div>
                    <button
                      onClick={() => toggleVIP(p)}
                      disabled={isToggling}
                      title={isVIP ? 'Remove from VIP' : 'Add to VIP'}
                      className="transition-all disabled:opacity-40 hover:scale-110 flex-shrink-0"
                    >
                      {isToggling ? (
                        <span className="text-xs text-gray-400">…</span>
                      ) : isVIP ? (
                        /* Filled star — VIP on */
                        <svg className="w-4 h-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ) : (
                        /* Outline star — VIP off */
                        <svg className="w-4 h-4 text-gray-300 hover:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                        </svg>
                      )}
                    </button>
                    {showHidden && hidden.has(p.email.toLowerCase()) ? (
                      <button
                        onClick={() => unhideContact(p.email)}
                        title="Restore contact"
                        className="text-[10px] text-gray-400 hover:text-accent transition-colors flex-shrink-0 px-1"
                      >↩</button>
                    ) : (
                      <button
                        onClick={() => hideContact(p.email)}
                        title="Remove / hide this contact"
                        className="text-gray-200 hover:text-red-400 transition-colors flex-shrink-0 text-xs leading-none px-0.5"
                      >✕</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
