import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api/client'
import type { CalEvent, CalendarResponse } from '../../types'

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft 365',
  none: 'Not connected',
}

const TODAY = new Date().toISOString().slice(0, 10)

function fmtTime(start: string): string {
  if (!start.includes('T')) return 'All day'
  return start.slice(11, 16)
}

function fmtDateHeading(date: string): string {
  const d = new Date(date + 'T00:00:00')
  const day = d.toLocaleDateString(undefined, { weekday: 'long' })
  const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${day} · ${md}`
}

function groupByDate(events: CalEvent[]): [string, CalEvent[]][] {
  const map = new Map<string, CalEvent[]>()
  for (const e of events) {
    const arr = map.get(e.date) ?? []
    arr.push(e)
    map.set(e.date, arr)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

function EventCard({ event }: { event: CalEvent }) {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm flex gap-3">
      <div className="font-mono text-sm font-semibold text-accent-600 dark:text-accent-400 flex-shrink-0 w-16">
        {fmtTime(event.start)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{event.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {event.is_online && (
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300">🟢 Online</span>
          )}
          {event.attendee_count > 1 && (
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">👥 {event.attendee_count}</span>
          )}
          {event.location && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 truncate max-w-[180px]">📍 {event.location}</span>
          )}
          {event.response === 'declined' && (
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300">Declined</span>
          )}
          {event.response === 'tentativelyAccepted' && (
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-950/50 text-yellow-700 dark:text-yellow-300">Maybe</span>
          )}
        </div>
      </div>
      {event.join_url && (
        <a
          href={event.join_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 self-center text-xs font-semibold px-3 py-1.5 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors"
        >
          Join
        </a>
      )}
    </div>
  )
}

export function CalendarTab() {
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (force?: boolean) => {
    setLoading(true)
    setError('')
    try {
      setData(await api.getCalendar(7, force))
    } catch (e: any) {
      setError(e?.message || 'Could not load calendar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <div className="h-8 w-48 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-md mx-auto text-center mt-16">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button onClick={() => load()} className="text-xs font-semibold px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors">Retry</button>
      </div>
    )
  }

  if (data?.provider === 'none') {
    const reason = (data as any)?.reason
    const isGmailImap = reason === 'gmail_imap'
    const isImapOnly = reason === 'imap_only'
    return (
      <div className="p-6 max-w-md mx-auto text-center mt-16">
        <div className="text-4xl mb-3">📅</div>
        {isGmailImap ? (
          <>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Gmail is connected via IMAP — calendar needs Google OAuth</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              IMAP only syncs email. To enable calendar, add your Google Client ID &amp; Secret in <strong>Settings → App Settings</strong>, then click <strong>Connect Google</strong> to authorise calendar access.
            </p>
          </>
        ) : isImapOnly ? (
          <>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Your email is connected via IMAP — calendar needs OAuth</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Connect a Google or Microsoft 365 account via OAuth in Settings to enable calendar access.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">Connect Google or Microsoft 365 in Settings to see your calendar.</p>
        )}
      </div>
    )
  }

  const groups = groupByDate(data?.events ?? [])

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">Calendar</h1>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-50 dark:bg-accent-950/40 text-accent-600 dark:text-accent-400">
            {PROVIDER_LABEL[data?.provider ?? 'none']}
          </span>
        </div>
        <button onClick={() => load(true)} className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:text-accent-600 border border-gray-200 dark:border-gray-700 hover:border-accent-300 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
          Refresh
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center mt-16">
          <div className="text-4xl mb-3">🗓</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">No events in the next 7 days.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([date, events]) => {
            const isToday = date === TODAY
            return (
              <div key={date}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className={`text-sm font-bold ${isToday ? 'text-accent-600 dark:text-accent-400' : 'text-gray-700 dark:text-gray-200'}`}>{fmtDateHeading(date)}</h2>
                  {isToday && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-accent-500 text-white">Today</span>}
                </div>
                <div className="space-y-2">
                  {events.map(e => <EventCard key={e.id} event={e} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
