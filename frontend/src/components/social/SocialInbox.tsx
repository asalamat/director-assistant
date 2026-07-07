import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api/client'
import type { SocialMessage } from '../../types'

type PlatformFilter = 'all' | 'instagram' | 'linkedin'

const PLATFORM_BADGE: Record<string, { icon: string; cls: string; label: string }> = {
  instagram: { icon: 'IG', cls: 'bg-pink-100 text-pink-600', label: 'Instagram' },
  linkedin: { icon: 'LI', cls: 'bg-blue-100 text-blue-700', label: 'LinkedIn' },
}

const TYPE_LABEL: Record<string, string> = { dm: 'DM', comment: 'Comment', mention: 'Mention' }

function timeAgo(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString()
}

export function SocialInbox() {
  const [messages, setMessages] = useState<SocialMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)
  const [feedback, setFeedback] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [hints, setHints] = useState<string[]>([])

  const load = useCallback(() => {
    setLoading(true)
    api.getSocialInbox({
      platform: platform === 'all' ? undefined : platform,
      unread: unreadOnly || undefined,
    })
      .then(r => setMessages(r.messages))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false))
  }, [platform, unreadOnly])

  useEffect(() => { load() }, [load])

  const sync = async () => {
    setSyncing(true); setSyncMsg(''); setHints([])
    const targets = platform === 'all' ? ['instagram', 'linkedin'] : [platform]
    let total = 0
    const errors: string[] = []
    const newHints: string[] = []
    for (const p of targets) {
      try {
        const r = await api.syncSocialInbox(p)
        if (r.error) errors.push(`${p}: ${r.error}`)
        else total += r.fetched
        if (r.hint) newHints.push(r.hint)
      } catch (e) {
        errors.push(`${p}: ${(e as Error).message}`)
      }
    }
    setSyncing(false)
    setSyncMsg(errors.length ? errors.join(' · ') : `${total} new message${total !== 1 ? 's' : ''}`)
    setHints(newHints)
    load()
  }

  const expand = (m: SocialMessage) => {
    if (expandedId === m.id) { setExpandedId(null); return }
    setExpandedId(m.id)
    setReplyText('')
    setFeedback(null)
    if (!m.is_read) {
      api.markSocialRead(m.id).then(() => {
        setMessages(prev => prev.map(x => x.id === m.id ? { ...x, is_read: 1 } : x))
      }).catch(() => {})
    }
  }

  const sendReply = async (m: SocialMessage) => {
    if (!replyText.trim()) return
    setReplying(true); setFeedback(null)
    try {
      const r = await api.replySocialMessage(m.id, replyText.trim())
      if (r.ok) {
        setFeedback({ id: m.id, ok: true, text: 'Reply sent' })
        setReplyText('')
        setMessages(prev => prev.map(x => x.id === m.id ? { ...x, replied_at: new Date().toISOString(), is_read: 1 } : x))
      } else {
        setFeedback({ id: m.id, ok: false, text: r.error || 'Reply failed' })
      }
    } catch (e) {
      setFeedback({ id: m.id, ok: false, text: (e as Error).message })
    } finally {
      setReplying(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="px-6 pt-5 pb-3 flex items-center gap-2 flex-wrap flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-900 mr-2">Social Inbox</h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['all', 'instagram', 'linkedin'] as PlatformFilter[]).map(p => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                platform === p ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {p === 'all' ? 'All' : PLATFORM_BADGE[p].label}
            </button>
          ))}
        </div>
        <button onClick={() => setUnreadOnly(v => !v)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
            unreadOnly ? 'bg-accent text-white border-accent' : 'border-gray-200 text-gray-500 hover:border-gray-300'
          }`}>
          Unread only
        </button>
        <div className="ml-auto flex items-center gap-2">
          {syncMsg && <span className="text-[11px] text-gray-400">{syncMsg}</span>}
          <button onClick={sync} disabled={syncing}
            className="text-xs bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-50 transition">
            {syncing ? 'Syncing…' : '↻ Sync'}
          </button>
        </div>
      </div>

      {/* Permission hints */}
      {hints.length > 0 && (
        <div className="mx-6 mb-2 space-y-2 flex-shrink-0">
          {hints.map((h, i) => {
            const isLI = h.includes('linkedin.com')
            const isIG = h.includes('instagram.com')
            const platformLabel = isLI ? 'LinkedIn' : isIG ? 'Instagram' : 'Platform'
            const notifUrl = isLI ? 'https://www.linkedin.com/notifications/' : 'https://www.instagram.com/accounts/activity/'
            return (
              <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800">
                <span className="mt-0.5 flex-shrink-0">⚠️</span>
                <div className="flex-1">
                  <span className="font-semibold">{platformLabel}:</span> Reading comments & DMs requires elevated API permissions not available with your current token.{' '}
                  <a href={notifUrl} target="_blank" rel="noreferrer" className="underline font-medium hover:text-amber-900">
                    View {platformLabel} notifications →
                  </a>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2 max-w-2xl">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            {platform === 'all'
              ? 'No messages yet — hit Sync to fetch DMs, comments & mentions.'
              : `No ${PLATFORM_BADGE[platform]?.label || platform} messages yet — hit Sync.`}
          </div>
        ) : messages.map(m => {
          const badge = PLATFORM_BADGE[m.platform]
          const expanded = expandedId === m.id
          return (
            <div key={m.id}
              className={`border rounded-xl transition-colors cursor-pointer ${
                m.is_read ? 'border-gray-200 bg-white' : 'border-accent/30 bg-blue-50/40'
              }`}>
              <div className="p-3 flex gap-3" onClick={() => expand(m)}>
                <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${badge?.cls || 'bg-gray-100 text-gray-500'}`}>
                  {badge?.icon || '?'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{m.sender_name || 'Unknown'}</span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">{TYPE_LABEL[m.type] || m.type}</span>
                    {!m.is_read && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                    {m.replied_at && <span className="text-[10px] text-green-600">↩ replied</span>}
                    <span className="ml-auto text-[10px] text-gray-400 flex-shrink-0">{timeAgo(m.created_at)}</span>
                  </div>
                  <p className={`text-xs text-gray-600 mt-0.5 ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                    {m.content || <span className="italic text-gray-300">(no text)</span>}
                  </p>
                </div>
              </div>

              {expanded && (
                <div className="border-t border-gray-100 px-3 py-2.5 space-y-2" onClick={e => e.stopPropagation()}>
                  {m.media_url && <img src={m.media_url} className="max-h-40 rounded-lg" alt="" />}
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={`Reply to ${m.sender_name || 'this message'}…`}
                    rows={2}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                  <div className="flex items-center gap-2">
                    {feedback?.id === m.id && (
                      <span className={`text-[11px] ${feedback.ok ? 'text-green-600' : 'text-red-500'}`}>{feedback.text}</span>
                    )}
                    <button onClick={() => sendReply(m)} disabled={replying || !replyText.trim()}
                      className="ml-auto text-xs bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-50 transition">
                      {replying ? 'Sending…' : 'Reply'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
