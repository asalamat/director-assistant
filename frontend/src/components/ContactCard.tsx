import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { SenderStats } from '../types'
import { ContactTimeline } from './ContactTimeline'

interface MonthlyData { months: { month: string; count: number }[] }

interface Props {
  sender: string
  onClose: () => void
  onSearch?: (sender: string) => void
}

interface Relationship {
  total_received: number; total_sent_to: number;
  last_received: string | null; last_sent_to: string | null;
  unreplied_count: number; avg_response_hours: number | null;
  ai_summary: string | null;
}

export function ContactCard({ sender, onClose, onSearch }: Props) {
  const [stats, setStats] = useState<SenderStats | null>(null)
  const [rel, setRel] = useState<Relationship | null>(null)
  const [monthly, setMonthly] = useState<MonthlyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [cardTab, setCardTab] = useState<'overview' | 'timeline'>('overview')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([
      api.getSenderStats(sender).catch(() => null),
      api.getContactRelationship(sender).catch(() => null),
      api.getSenderMonthlyVolume(sender).catch(() => null),
    ]).then(([s, r, m]) => {
      setStats(s)
      setRel(r)
      setMonthly(m)
    }).finally(() => setLoading(false))
  }, [sender])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const displayName = sender.match(/^([^<]+)</) ?.[1]?.trim() || sender
  const email = sender.match(/<([^>]+)>/) ?.[1] || sender

  const linkedInUrl = (() => {
    const domain = email.split('@')[1] || ''
    // Strip common email providers — not useful as company hints
    const generic = new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','me.com','live.com','msn.com'])
    const company = !generic.has(domain) ? domain.replace(/\.(com|org|net|io|co|ca|uk|au|de|fr)$/, '').split('.').pop() || '' : ''
    const keywords = [displayName, company].filter(Boolean).join(' ')
    return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`
  })()

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-72 text-sm"
      style={{ top: '100%', left: 0 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center text-base font-bold flex-shrink-0">
          {displayName[0]?.toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{displayName}</p>
          <p className="text-xs text-gray-400 truncate">{email}</p>
        </div>
        <button onClick={onClose} className="ml-auto text-gray-300 hover:text-gray-500 flex-shrink-0">✕</button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-3 border-b border-gray-100 mb-3">
        {(['overview', 'timeline'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setCardTab(t)}
            className={`text-xs pb-1.5 font-medium border-b-2 transition-colors capitalize ${
              cardTab === t ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {cardTab === 'timeline' && <ContactTimeline emailAddr={email} />}

      {cardTab === 'overview' && loading && <p className="text-xs text-gray-400 text-center py-3">Loading…</p>}

      {cardTab === 'overview' && stats && !loading && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-lg font-bold text-gray-800">{stats.total_emails}</p>
              <p className="text-[10px] text-gray-400">emails</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-xs font-semibold text-gray-700">{stats.first_contact?.slice(0, 10) ?? '—'}</p>
              <p className="text-[10px] text-gray-400">first</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-xs font-semibold text-gray-700">{stats.last_contact?.slice(0, 10) ?? '—'}</p>
              <p className="text-[10px] text-gray-400">last</p>
            </div>
          </div>

          {/* Relationship intelligence */}
          {rel && (
            <div className="bg-blue-50 rounded-lg p-2.5 space-y-1.5">
              {rel.ai_summary && (
                <p className="text-xs text-gray-700 leading-relaxed">{rel.ai_summary}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-1">
                {rel.unreplied_count > 0 && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                    {rel.unreplied_count} unreplied
                  </span>
                )}
                {rel.avg_response_hours != null && (
                  <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                    avg reply {rel.avg_response_hours}h
                  </span>
                )}
                {rel.last_sent_to && (
                  <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                    you sent {rel.last_sent_to}
                  </span>
                )}
              </div>
            </div>
          )}

          {monthly && monthly.months.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Email volume</p>
              <div className="flex items-end gap-0.5 h-8">
                {monthly.months.slice(-6).map(m => {
                  const max = Math.max(...monthly.months.map(x => x.count), 1)
                  const h = Math.max(2, Math.round((m.count / max) * 28))
                  return (
                    <div key={m.month} title={`${m.month}: ${m.count}`}
                      className="bg-accent rounded-t-sm flex-1 min-w-0"
                      style={{ height: `${h}px` }} />
                  )
                })}
              </div>
              <div className="flex gap-0.5 mt-0.5">
                {monthly.months.slice(-6).map(m => (
                  <div key={m.month} className="flex-1 text-center text-[8px] text-gray-300 truncate">{m.month.slice(5)}</div>
                ))}
              </div>
            </div>
          )}

          {stats.recent_subjects.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Recent subjects</p>
              {stats.recent_subjects.slice(0, 4).map((s, i) => (
                <p key={i} className="text-xs text-gray-600 truncate py-0.5 border-b border-gray-50 last:border-0">· {s}</p>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-0.5 mt-1">
            {onSearch && (
              <button
                onClick={() => { onSearch(email); onClose() }}
                className="text-xs text-accent hover:underline text-left"
              >
                Search all emails from this sender →
              </button>
            )}
            <a
              href={linkedInUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#0077b5] hover:underline flex items-center gap-1"
            >
              <svg className="w-3 h-3 fill-current flex-shrink-0" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              Find on LinkedIn
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
