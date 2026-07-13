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
    const isGmailImap = reason === 'gmail_imap' || reason === 'imap_only'

    const handleConnectGoogle = async () => {
      try {
        const { url } = await api.getGoogleAuthUrl()
        const popup = window.open(url, 'gcal-auth', 'width=520,height=680,left=200,top=80')
        if (!popup) { alert('Popup blocked — allow popups and try again.'); return }
        const onMsg = (e: MessageEvent) => {
          if (e.data?.type === 'oauth-complete' || e.data?.type === 'oauth-error') {
            window.removeEventListener('message', onMsg)
            if (e.data?.type === 'oauth-complete') load(true)
          }
        }
        window.addEventListener('message', onMsg)
        const t = setInterval(() => { if (popup.closed) { clearInterval(t); window.removeEventListener('message', onMsg) } }, 800)
      } catch { /* silent */ }
    }

    return (
      <div className="p-6 max-w-md mx-auto text-center mt-16">
        <div className="text-4xl mb-3">📅</div>
        {isGmailImap ? (
          <>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Calendar needs Google OAuth authorisation</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Your Gmail is connected for email but calendar requires a separate OAuth sign-in to access Google Calendar.
            </p>
            <button
              onClick={handleConnectGoogle}
              className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl bg-white border border-gray-300 shadow-sm hover:bg-gray-50 text-gray-700 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Sign in with Google
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Connect Google or Microsoft 365 to see your calendar.</p>
            <button
              onClick={handleConnectGoogle}
              className="inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-xl bg-white border border-gray-300 shadow-sm hover:bg-gray-50 text-gray-700 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Sign in with Google
            </button>
          </>
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
