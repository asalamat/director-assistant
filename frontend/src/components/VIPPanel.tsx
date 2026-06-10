import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { EmptyState, Spinner, Button, Avatar } from './ui'
import { useEmailContext } from '../contexts/EmailContext'
import { useUIContext } from '../contexts/UIContext'

interface VIP {
  id: number; email_addr: string; name: string; note: string
  emails_received: number; last_received: string | null
  emails_sent_to: number; last_sent_to: string | null
  unread: number; awaiting_reply: boolean; created_at: string
}

interface VIPEmail {
  id: string; subject: string; sender: string; date: string
  folder: string; is_read: boolean; body?: string; recipients?: string
}

function daysSince(dateStr: string | null): string {
  if (!dateStr) return 'never'
  const ms = Date.now() - new Date(dateStr).getTime()
  const d = ms / 86400000
  if (d < 1) return 'today'
  if (d < 2) return 'yesterday'
  if (d < 7) return `${Math.floor(d)} days ago`
  if (d < 30) return `${Math.floor(d / 7)} weeks ago`
  return `${Math.floor(d / 30)} months ago`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 86400000
  if (diff < 1) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function initials(name: string, email: string): string {
  const src = name || email
  const parts = src.replace(/<.*>/, '').trim().split(' ')
  return parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

// ── VIP Detail View ───────────────────────────────────────────────────────────

function VIPDetail({
  vip, onBack
}: {
  vip: VIP
  onBack: () => void
}) {
  const { fetchEmail } = useEmailContext()
  const { setActiveTab } = useUIContext()
  const handleEmailSelect = (id: string) => {
    fetchEmail(id)
    setActiveTab('inbox')
  }
  const [emails, setEmails] = useState<VIPEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'received' | 'sent'>('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(30)
  const [health, setHealth] = useState<{ trend: 'warming' | 'stable' | 'cooling'; windows: { start: string; end: string; count: number }[]; total_90d: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    api.getVIPEmails(vip.email_addr, 100)
      .then(r => setEmails(r.emails))
      .catch(() => setEmails([]))
      .finally(() => setLoading(false))
    api.getVIPHealth(vip.id)
      .then(h => setHealth(h))
      .catch(() => {})
  }, [vip.email_addr, vip.id])

  const isSent = (e: VIPEmail) => e.folder?.toLowerCase().includes('sent')

  const filtered = emails
    .filter(e => {
      if (filter === 'received') return !isSent(e)
      if (filter === 'sent') return isSent(e)
      return true
    })
    .filter(e => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (e.subject || '').toLowerCase().includes(q) ||
             (e.sender || '').toLowerCase().includes(q)
    })
    .slice(0, limit)

  const received = emails.filter(e => !isSent(e))
  const sent = emails.filter(e => isSent(e))
  const unread = emails.filter(e => !e.is_read && !isSent(e))

  // Response time estimate
  const avgDays = (() => {
    if (!vip.last_received || !vip.last_sent_to) return null
    const r = new Date(vip.last_received).getTime()
    const s = new Date(vip.last_sent_to).getTime()
    const diff = Math.abs(r - s) / 86400000
    return diff < 30 ? diff.toFixed(1) : null
  })()

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <button onClick={onBack} className="flex items-center gap-1 text-xs text-gray-400 hover:text-accent mb-3 transition-colors">
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
          Back to VIP list
        </button>

        <div className="flex items-start gap-4">
          <Avatar name={vip.name || vip.email_addr} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-gray-900">{vip.name || vip.email_addr}</h2>
              {vip.awaiting_reply && (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">Awaiting reply</span>
              )}
              {vip.unread > 0 && (
                <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">{vip.unread} unread</span>
              )}
            </div>
            <p className="text-sm text-gray-500">{vip.email_addr}</p>
            {vip.note && <p className="text-xs text-gray-400 mt-0.5 italic">{vip.note}</p>}
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[
            { label: 'Received', value: vip.emails_received, sub: daysSince(vip.last_received) },
            { label: 'Sent', value: vip.emails_sent_to, sub: daysSince(vip.last_sent_to) },
            { label: 'Unread', value: vip.unread, sub: vip.unread > 0 ? 'needs attention' : 'all read' },
            { label: 'Avg reply', value: avgDays ? `${avgDays}d` : '—', sub: avgDays ? 'response time' : 'insufficient data' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-gray-50 rounded-xl p-2.5 text-center">
              <p className="text-lg font-bold text-gray-900">{value}</p>
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">{sub}</p>
            </div>
          ))}
        </div>

        {/* 90-day activity sparkline */}
        {health && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">90-day activity</p>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                health.trend === 'warming' ? 'bg-green-100 text-green-700' :
                health.trend === 'cooling' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                {health.trend === 'warming' ? '↗ Warming' :
                 health.trend === 'cooling' ? '↘ Cooling' : '→ Stable'}
              </span>
            </div>
            {/* Sparkline bars */}
            <div className="flex items-end gap-0.5 h-8">
              {health.windows.map((w, i) => {
                const maxCount = Math.max(...health.windows.map(x => x.count), 1)
                const pct = Math.max(4, Math.round((w.count / maxCount) * 100))
                return (
                  <div key={i} title={`${w.start}: ${w.count} emails`}
                    className="flex-1 rounded-t-sm bg-accent/40 transition-all hover:bg-accent/70"
                    style={{ height: `${pct}%` }}
                  />
                )
              })}
            </div>
            <p className="text-[9px] text-gray-300 mt-0.5">{health.total_90d} emails in last 90 days</p>
          </div>
        )}
      </div>

      {/* Filter + Search */}
      <div className="px-4 py-2 border-b border-gray-50 flex items-center gap-2 flex-shrink-0">
        <div className="flex gap-1">
          {(['all', 'received', 'sent'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === f ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              {f === 'all' ? `All (${emails.length})` : f === 'received' ? `Received (${received.length})` : `Sent (${sent.length})`}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search subject…"
          className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
        />
      </div>

      {/* Email list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-12">
            <Spinner size="md" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="py-12">
            <EmptyState
              icon="📭"
              title={search ? 'No matching emails' : 'No emails found for this contact'}
            />
          </div>
        )}
        {!loading && filtered.map(email => {
          const sent = isSent(email)
          return (
            <div
              key={email.id}
              onClick={() => handleEmailSelect(email.id)}
              className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors group ${!email.is_read && !sent ? 'bg-amber-50/50' : ''}`}
            >
              <div className="flex items-start gap-3">
                {/* Direction indicator */}
                <div className={`flex-shrink-0 mt-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${sent ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}
                  title={sent ? 'Sent' : 'Received'}>
                  {sent ? '↑' : '↓'}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm truncate ${!email.is_read && !sent ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'}`}>
                      {email.subject || '(no subject)'}
                    </p>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(email.date)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500 truncate">
                      {sent ? `To: ${vip.name || vip.email_addr}` : `From: ${email.sender?.replace(/<[^>]+>/, '').trim()}`}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${sent ? 'bg-blue-50 text-blue-500' : 'bg-gray-100 text-gray-400'}`}>
                      {email.folder}
                    </span>
                    {!email.is_read && !sent && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                    )}
                  </div>
                </div>

                <svg className="w-4 h-4 text-gray-300 group-hover:text-accent flex-shrink-0 mt-0.5 transition-colors" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                </svg>
              </div>
            </div>
          )
        })}

        {!loading && filtered.length >= limit && emails.length > limit && (
          <div className="px-4 py-3 text-center">
            <button onClick={() => setLimit(l => l + 30)}
              className="text-xs text-accent hover:underline">
              Load more ({emails.length - limit} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── VIP List View ─────────────────────────────────────────────────────────────

export function VIPPanel() {
  const [vips, setVips] = useState<VIP[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<VIP | null>(null)

  const load = () => {
    setLoading(true)
    api.getVIPs().then(r => setVips(r.vips)).catch(() => setVips([])).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (selected) {
    return (
      <VIPDetail
        vip={selected}
        onBack={() => setSelected(null)}
      />
    )
  }

  const add = async () => {
    if (!newEmail.trim()) return
    setSaving(true)
    try {
      await api.addVIP({ email_addr: newEmail.trim(), name: newName.trim(), note: newNote.trim() })
      setNewEmail(''); setNewName(''); setNewNote(''); setShowAdd(false)
      load()
    } catch { /* duplicate or error */ }
    setSaving(false)
  }

  const remove = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await api.removeVIP(id)
    setVips(prev => prev.filter(v => v.id !== id))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">VIP Contacts</h2>
          <p className="text-xs text-gray-400 mt-0.5">{vips.length} contact{vips.length !== 1 ? 's' : ''} · click any to see full history</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowAdd(v => !v)}>+ Add VIP</Button>
      </div>

      {showAdd && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex-shrink-0 space-y-2">
          <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email address *"
            className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
            onKeyDown={e => e.key === 'Enter' && add()} autoFocus />
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Display name (optional)"
            className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
          <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Note (optional — e.g. 'Board member', 'Key client')"
            className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="text-xs text-gray-500 px-2 py-1 hover:text-gray-700">Cancel</button>
            <Button variant="primary" size="sm" loading={saving} onClick={add} disabled={saving || !newEmail.trim()}>Add VIP</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-12">
            <Spinner size="md" />
          </div>
        )}
        {!loading && vips.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <EmptyState
              icon="⭐"
              title="No VIP contacts yet"
              description="Add your board members, key clients, and direct reports to track all their emails in one place."
              action={<Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>Add your first VIP</Button>}
            />
          </div>
        )}

        {vips.map(vip => (
          <div key={vip.id} onClick={() => setSelected(vip)}
            className="px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors group">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-blue-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                {initials(vip.name, vip.email_addr)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-800">{vip.name || vip.email_addr}</p>
                  {vip.awaiting_reply && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">awaiting reply</span>
                  )}
                  {vip.unread > 0 && (
                    <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">{vip.unread} unread</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 truncate">{vip.name ? vip.email_addr : ''}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-gray-400">📥 {vip.emails_received} · {daysSince(vip.last_received)}</span>
                  <span className="text-[10px] text-gray-400">📤 {vip.emails_sent_to} · {daysSince(vip.last_sent_to)}</span>
                </div>
                {vip.note && <p className="text-xs text-gray-400 mt-0.5 italic truncate">{vip.note}</p>}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <svg className="w-4 h-4 text-gray-300 group-hover:text-accent transition-colors" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                </svg>
                <span className="opacity-0 group-hover:opacity-100 transition-all ml-1">
                  <Button variant="ghost" size="xs" onClick={e => remove(vip.id, e)} title="Remove from VIP">✕</Button>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
