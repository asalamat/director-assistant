import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { TimelineEvent } from '../../types'

interface TimelineTabProps {
  initialQuery?: string
}

export function TimelineTab({ initialQuery = '' }: TimelineTabProps) {
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
