import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { addToast } from './Toast'
import { Spinner, EmptyState } from './ui'

interface Member { name: string; email: string }
interface Group { name: string; color: string; members: Member[] }

const COLOR_MAP: Record<string, string> = {
  blue:   'bg-blue-100 text-blue-700 border-blue-200',
  green:  'bg-green-100 text-green-700 border-green-200',
  purple: 'bg-purple-100 text-purple-700 border-purple-200',
  orange: 'bg-orange-100 text-orange-700 border-orange-200',
  red:    'bg-red-100 text-red-700 border-red-200',
  gray:   'bg-gray-100 text-gray-700 border-gray-200',
}

const DOT_MAP: Record<string, string> = {
  blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500',
  orange: 'bg-orange-500', red: 'bg-red-500', gray: 'bg-gray-400',
}

export function ContactGroupsPanel({ onSearch }: { onSearch?: (query: string) => void }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.getContactGroups()
      .then(r => setGroups(r.groups))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const r = await api.autoGroupContacts()
      setGroups(r.groups)
      setExpanded(new Set(r.groups.map(g => g.name)))
      addToast(`Created ${r.groups.length} contact groups`, 'success')
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Grouping failed', 'warning')
    } finally {
      setGenerating(false)
    }
  }

  const toggle = (name: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">Contact Groups</h3>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {generating ? (
            <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
          )}
          {generating ? 'Grouping…' : groups.length ? 'Regroup' : 'Auto-group contacts'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && <div className="flex justify-center py-8"><Spinner size="md" /></div>}
        {!loading && groups.length === 0 && (
          <EmptyState icon="👥" title="No groups yet" description="Click Auto-group to let AI cluster your contacts." />
        )}
        {groups.map(g => {
          const colorCls = COLOR_MAP[g.color] || COLOR_MAP.gray
          const dotCls = DOT_MAP[g.color] || DOT_MAP.gray
          const open = expanded.has(g.name)
          return (
            <div key={g.name} className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => toggle(g.name)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-white hover:bg-gray-50 transition-colors text-left"
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotCls}`} />
                <span className="text-sm font-medium text-gray-800 flex-1">{g.name}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colorCls}`}>
                  {g.members.length}
                </span>
                <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {open && (
                <div className="border-t border-gray-100 divide-y divide-gray-50">
                  {g.members.map(m => (
                    <div key={m.email} className="flex items-center gap-2.5 px-3 py-2 bg-gray-50">
                      <div className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                        {m.name[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{m.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{m.email}</p>
                      </div>
                      {onSearch && (
                        <button
                          onClick={() => onSearch(m.email)}
                          className="text-[10px] text-accent hover:underline flex-shrink-0"
                        >
                          Search
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
