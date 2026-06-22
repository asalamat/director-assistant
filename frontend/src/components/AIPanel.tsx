import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { AIRecommendation, EmailMessage } from '../types'

interface Props {
  rec: AIRecommendation | null
  loading: boolean
  error: string
  email: EmailMessage | null
}

const URGENCY_STYLES: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

const TONE_ICON: Record<string, string> = {
  formal: '🎩', casual: '💬', urgent: '⚡', friendly: '😊', neutral: '📄',
}

const LABELS = ['Brief', 'Professional', 'Detailed']

export function AIPanel({ rec, loading, error, email }: Props) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [draftIdx, setDraftIdx] = useState<number | null>(null)
  const [draftText, setDraftText] = useState('')
  const [savedDraftIdx, setSavedDraftIdx] = useState<number | null>(null)
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [followUpNote, setFollowUpNote] = useState('')
  const [actionsSaved, setActionsSaved] = useState(false)
  const autoSavedFor = useRef<string | null>(null)
  const [senderStats, setSenderStats] = useState<{
    total_emails: number; first_contact: string | null; last_contact: string | null; recent_subjects: string[]
  } | null>(null)
  const [loadingSender, setLoadingSender] = useState(false)

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  const openDraft = (text: string, idx: number) => {
    setDraftIdx(idx)
    setDraftText(text)
  }

  // Feature 1: auto-save action items when analysis arrives for a new email
  useEffect(() => {
    if (rec?.action_items.length && email && autoSavedFor.current !== email.id) {
      autoSavedFor.current = email.id
      fetch('/api/actions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_id: email.id, email_subject: email.subject, items: rec.action_items }),
      }).then(r => { if (r.ok) setActionsSaved(true) }).catch(() => {})
    }
  }, [rec, email])

  // Feature 2: open default mail client with pre-filled reply
  const openMailto = (body: string) => {
    if (!email) return
    const to = email.sender.match(/<([^>]+)>/)?.[1] || email.sender
    const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent('\n\n---\n' + body)}`
  }

  const saveActions = async () => {
    if (!email || !rec?.action_items.length) return
    try {
      const res = await fetch('/api/actions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_id: email.id,
          email_subject: email.subject,
          items: rec.action_items,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      setActionsSaved(true)
      setTimeout(() => setActionsSaved(false), 2000)
    } catch {
      // show brief error feedback on the button
      setActionsSaved(false)
    }
  }

  const createFollowUp = async () => {
    if (!email || !dueDate) return
    try {
      await api.createFollowUp({
        email_id: email.id,
        subject: email.subject,
        sender: email.sender,
        due_date: dueDate,
        note: followUpNote,
      })
      setShowFollowUp(false)
      setDueDate('')
      setFollowUpNote('')
    } catch {
      // silently ignore — form stays open so user can retry
    }
  }

  const saveDraft = async (body: string, idx: number) => {
    if (!email) return
    const to = email.sender.match(/<([^>]+)>/)?.[1] || email.sender
    const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`
    try {
      await api.saveDraft({ to, subject, body })
      setSavedDraftIdx(idx)
      setTimeout(() => setSavedDraftIdx(null), 2000)
    } catch { /* ignore — provider may not support it */ }
  }

  const loadSenderStats = async () => {
    if (!email) return
    setLoadingSender(true)
    try {
      setSenderStats(await api.getSenderStats(email.sender))
    } finally {
      setLoadingSender(false)
    }
  }

  if (loading) {
    return (
      <div className="w-80 flex-shrink-0 bg-gray-50 border-l border-gray-200 flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Analyzing email…</p>
        <p className="text-xs text-gray-400 text-center">RAG search + Claude re-ranking + generating replies</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-80 flex-shrink-0 bg-gray-50 border-l border-gray-200 flex items-center justify-center p-6">
        <p className="text-sm text-red-500 text-center">{error}</p>
      </div>
    )
  }

  if (!rec) {
    return (
      <div className="w-80 flex-shrink-0 bg-gray-50 border-l border-gray-200 flex flex-col items-center justify-center gap-2 p-6">
        <div className="text-3xl">✦</div>
        <p className="text-sm text-gray-400 text-center">Click "AI Analysis" to get reply suggestions</p>
        {email && (
          <button
            onClick={() => { setSenderStats(null); loadSenderStats() }}
            className="mt-2 text-xs text-accent hover:underline"
          >
            View sender stats
          </button>
        )}
        {senderStats && <SenderStatsCard sender={email?.sender ?? ''} stats={senderStats} />}
        {loadingSender && <p className="text-xs text-gray-400">Loading…</p>}
      </div>
    )
  }

  return (
    <div className="w-80 flex-shrink-0 bg-gray-50 border-l border-gray-200 flex flex-col overflow-y-auto">
      {/* Urgency + tone + follow-up button */}
      <div className="px-4 pt-4 flex gap-2 flex-wrap items-center">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full animate-pop ${URGENCY_STYLES[rec.urgency] ?? 'bg-gray-100 text-gray-600'}`}>
          {rec.urgency.charAt(0).toUpperCase() + rec.urgency.slice(1)} urgency
        </span>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 animate-pop" style={{ animationDelay: '60ms' }}>
          {TONE_ICON[rec.tone] ?? '📄'} {rec.tone}
        </span>
        <button
          onClick={() => setShowFollowUp(true)}
          className="ml-auto text-xs border border-gray-300 text-gray-600 px-2 py-0.5 rounded hover:bg-gray-100"
        >
          Follow up
        </button>
      </div>

      {/* Follow-up form */}
      {showFollowUp && (
        <div className="mx-4 mt-3 p-3 border border-accent rounded-xl bg-blue-50 space-y-2">
          <p className="text-xs font-medium text-gray-700">Schedule follow-up</p>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1"
          />
          <input
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full text-xs border border-gray-300 rounded px-2 py-1"
          />
          <div className="flex gap-2">
            <button
              onClick={createFollowUp}
              disabled={!dueDate}
              className="text-xs bg-accent text-white px-2.5 py-1 rounded disabled:opacity-50"
            >
              Save
            </button>
            <button onClick={() => setShowFollowUp(false)} className="text-xs text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      {/* Analysis */}
      {rec.analysis && (
        <div className="px-4 pt-3">
          <p className="text-xs text-gray-600 leading-relaxed">{rec.analysis}</p>
        </div>
      )}

      {/* Key Points */}
      {rec.key_points.length > 0 && (
        <Section title="Key Points">
          <ul className="space-y-1">
            {rec.key_points.map((p, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-gray-300 mt-0.5">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Action Items */}
      {rec.action_items.length > 0 && (
        <Section title="Action Items">
          <ul className="space-y-1 mb-2">
            {rec.action_items.map((a, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-accent mt-0.5">☐</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={saveActions}
            className="text-xs text-accent hover:underline"
          >
            {actionsSaved ? '✓ Saved to board' : 'Save to action board'}
          </button>
        </Section>
      )}

      {/* Suggested Replies — with Draft Composer */}
      {rec.suggested_replies.length > 0 && (
        <Section title="Suggested Replies">
          <div className="space-y-2">
            {rec.suggested_replies.map((reply, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-gray-500">{LABELS[i] ?? `Option ${i + 1}`}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openDraft(reply, i)}
                      className="text-xs text-gray-400 hover:text-gray-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => copy(draftIdx === i ? draftText : reply, i)}
                      className="text-xs text-accent hover:text-blue-700"
                    >
                      {copiedIdx === i ? '✓ Copied' : 'Copy'}
                    </button>
                    <button
                      onClick={() => openMailto(draftIdx === i ? draftText : reply)}
                      className="text-xs text-green-600 hover:text-green-800"
                      title="Open in mail client"
                    >
                      Reply
                    </button>
                    <button
                      onClick={() => saveDraft(draftIdx === i ? draftText : reply, i)}
                      className="text-xs text-purple-500 hover:text-purple-700"
                      title="Save as draft in your mailbox"
                    >
                      {savedDraftIdx === i ? '✓ Saved' : 'Draft'}
                    </button>
                  </div>
                </div>
                {draftIdx === i ? (
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={6}
                    className="w-full text-xs text-gray-700 border border-accent rounded p-1.5 resize-none focus:outline-none"
                    autoFocus
                  />
                ) : (
                  <p className="text-xs text-gray-700 leading-relaxed">{reply}</p>
                )}
                {draftIdx === i && (
                  <button
                    onClick={() => setDraftIdx(null)}
                    className="text-xs text-gray-400 hover:text-gray-700 mt-1"
                  >
                    Done editing
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Sender stats */}
      {email && (
        <Section title="Sender">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600 truncate">{email.sender}</p>
            <button
              onClick={loadSenderStats}
              className="text-xs text-accent hover:underline flex-shrink-0"
            >
              {loadingSender ? '…' : 'Stats'}
            </button>
          </div>
          {senderStats && <SenderStatsCard sender={email.sender} stats={senderStats} />}
        </Section>
      )}

      {/* Similar Emails */}
      {rec.similar_emails.length > 0 && (
        <Section title="Similar Past Emails">
          <div className="space-y-2">
            {rec.similar_emails.map((e) => (
              <div key={e.id} className="bg-white border border-gray-200 rounded-lg p-2.5">
                <p className="text-xs font-medium text-gray-800 truncate">{e.subject}</p>
                <p className="text-xs text-gray-400 truncate">{e.sender}</p>
                {e.date && (
                  <p className="text-xs text-gray-300 mt-0.5">
                    {new Date(e.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="h-4" />
    </div>
  )
}

function SenderStatsCard({
  sender,
  stats,
}: {
  sender: string
  stats: { total_emails: number; first_contact: string | null; last_contact: string | null; recent_subjects: string[] }
}) {
  return (
    <div className="mt-2 p-2.5 bg-white border border-gray-200 rounded-lg space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">Total emails</span>
        <span className="font-medium text-gray-800">{stats.total_emails}</span>
      </div>
      {stats.first_contact && (
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">First contact</span>
          <span className="text-gray-600">{stats.first_contact.slice(0, 10)}</span>
        </div>
      )}
      {stats.last_contact && (
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Last contact</span>
          <span className="text-gray-600">{stats.last_contact.slice(0, 10)}</span>
        </div>
      )}
      {stats.recent_subjects.length > 0 && (
        <div className="pt-1 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-1">Recent subjects</p>
          {stats.recent_subjects.slice(0, 3).map((s, i) => (
            <p key={i} className="text-xs text-gray-600 truncate">· {s}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  )
}
