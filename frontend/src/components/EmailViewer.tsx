import { useState, useEffect, useCallback } from 'react'
import type { EmailMessage, QuickReplies } from '../types'
import { ContactCard } from './ContactCard'
import { api } from '../api/client'

interface Props {
  email: EmailMessage | null
  loading: boolean
  onAnalyze: () => void
  analyzing: boolean
  onDelete: (id: string) => void
  onSnooze?: (emailId: string, wakeDate: string) => void
  onAsk?: () => void
  onSearch?: (q: string) => void
}

function formatDateFull(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString([], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function EmailViewer({ email, loading, onAnalyze, analyzing, onDelete, onSnooze, onAsk, onSearch }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [showSnooze, setShowSnooze] = useState(false)
  const [snoozeDate, setSnoozeDate] = useState('')
  const [showContact, setShowContact] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [replyTo, setReplyTo] = useState('')
  const [replySubject, setReplySubject] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [showRemind, setShowRemind] = useState(false)
  const [remindDays, setRemindDays] = useState<number | null>(null)
  const [remindMsg, setRemindMsg] = useState('')
  // Quick replies
  const [quickReplies, setQuickReplies] = useState<QuickReplies | null>(null)
  const [loadingReplies, setLoadingReplies] = useState(false)
  // Unsubscribe
  const [unsubUrl, setUnsubUrl] = useState<string | null | undefined>(undefined)
  // Create event
  const [showEventModal, setShowEventModal] = useState(false)
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventTime, setEventTime] = useState('10:00')
  const [eventDuration, setEventDuration] = useState(1)
  const [eventAttendees, setEventAttendees] = useState('')
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [eventMsg, setEventMsg] = useState('')

  useEffect(() => {
    setShowCompose(false)
    setSendMsg('')
    setShowRemind(false)
    setRemindMsg('')
    setRemindDays(null)
    setQuickReplies(null)
    setUnsubUrl(undefined)
    setShowEventModal(false)
    setEventMsg('')
    if (email) {
      // Pre-fill event modal defaults
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
      setEventTitle(email.subject || '')
      setEventDate(tomorrow.toISOString().slice(0, 10))
      setEventAttendees(email.recipients.join(', '))
      // Lazy-detect unsubscribe link
      api.getUnsubscribeUrl(email.id).then(r => setUnsubUrl(r.url)).catch(() => setUnsubUrl(null))
    }
  }, [email?.id])

  const handleRemindMe = async (days: number) => {
    if (!email) return
    setRemindDays(days)
    const d = new Date()
    d.setDate(d.getDate() + days)
    const remindAt = d.toISOString().slice(0, 10)
    try {
      await api.setFollowupRemind(email.id, remindAt)
      setRemindMsg(`Reminder set for ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`)
      setTimeout(() => { setShowRemind(false); setRemindMsg('') }, 2000)
    } catch {
      setRemindMsg('Failed to set reminder')
    }
    setRemindDays(null)
  }

  const handleLoadReplies = async () => {
    if (!email || loadingReplies) return
    setLoadingReplies(true)
    try {
      const r = await api.getQuickReplies(email.id)
      setQuickReplies(r)
    } catch { setQuickReplies({ short: 'Failed to generate', detailed: '', formal: '' }) }
    finally { setLoadingReplies(false) }
  }

  const handleCreateEvent = async () => {
    if (!email) return
    setCreatingEvent(true); setEventMsg('')
    try {
      const start = `${eventDate}T${eventTime}:00`
      const endHour = (parseInt(eventTime.split(':')[0]) + eventDuration).toString().padStart(2, '0')
      const end = `${eventDate}T${endHour}:${eventTime.split(':')[1]}:00`
      const attendees = eventAttendees.split(',').map(a => a.trim()).filter(a => a.includes('@'))
      await api.createCalendarEvent(email.id, { title: eventTitle, start_datetime: start, end_datetime: end, attendees, description: `From email: ${email.subject}` })
      setEventMsg('Event created!'); setTimeout(() => setShowEventModal(false), 1500)
    } catch (e: any) { setEventMsg(e.message || 'Failed') }
    finally { setCreatingEvent(false) }
  }

  const handleReplyClick = () => {
    const senderEmail = email?.sender.match(/<([^>]+)>/)?.[1] || email?.sender || ''
    setReplyTo(senderEmail)
    setReplySubject(`Re: ${email?.subject || ''}`)
    setReplyBody('')
    setShowCompose(true)
  }

  const handleSend = async () => {
    if (!replyTo.trim()) return
    setSending(true)
    setSendMsg('')
    try {
      await api.sendEmail({ to: replyTo, subject: replySubject, body: replyBody })
      setSendMsg('Sent!')
      setTimeout(() => { setShowCompose(false); setSendMsg('') }, 1500)
    } catch (e: any) {
      setSendMsg(e.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const handleSnoozeConfirm = () => {
    if (!email || !snoozeDate) return
    onSnooze?.(email.id, snoozeDate)
    setShowSnooze(false)
    setSnoozeDate('')
  }

  const handleDelete = async () => {
    if (!email) return
    setDeleting(true)
    try {
      onDelete(email.id)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-gray-400 text-sm animate-pulse">Loading email…</div>
      </div>
    )
  }

  if (!email) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white gap-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl bg-accent/10 flex items-center justify-center animate-float">
            <svg className="w-10 h-10 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-accent rounded-full flex items-center justify-center animate-pulse">
            <span className="text-white text-[9px] font-bold">✦</span>
          </div>
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-gray-700">Select an email</p>
          <p className="text-xs text-gray-400">AI analysis, replies, and insights await</p>
        </div>
        <div className="flex gap-3 text-xs text-gray-400 mt-1">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">j/k</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-mono">a</kbd>
            analyze
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900 flex-1">{email.subject || '(no subject)'}</h2>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <button
              onClick={handleReplyClick}
              className="flex items-center gap-1.5 bg-gray-100 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
              <span>Reply</span>
            </button>
            <button
              onClick={onAnalyze}
              disabled={analyzing}
              className="flex items-center gap-1.5 bg-accent text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              {analyzing ? (
                <>
                  <span className="animate-spin">⟳</span>
                  <span>Analyzing…</span>
                </>
              ) : (
                <>
                  <span>✦</span>
                  <span>AI Analysis</span>
                </>
              )}
            </button>
            {onAsk && (
              <button
                onClick={onAsk}
                title="Ask AI about this email"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-accent px-2 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clipRule="evenodd" />
                </svg>
                <span>Ask</span>
              </button>
            )}
            {onSnooze && (
              <>
                <button
                  onClick={() => setShowSnooze(s => !s)}
                  title="Snooze this email"
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-amber-600 px-2 py-1.5 rounded-lg hover:bg-amber-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  <span>Snooze</span>
                </button>
                {showSnooze && (
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={snoozeDate}
                      min={tomorrowStr}
                      onChange={e => setSnoozeDate(e.target.value)}
                      className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      onClick={handleSnoozeConfirm}
                      disabled={!snoozeDate}
                      className="text-xs bg-amber-500 text-white px-2 py-1 rounded hover:bg-amber-600 disabled:opacity-50"
                    >
                      OK
                    </button>
                    <button onClick={() => setShowSnooze(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                )}
              </>
            )}
            {/* Remind me */}
            <div className="relative">
              <button
                onClick={() => setShowRemind(s => !s)}
                title="Set follow-up reminder"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 px-2 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                </svg>
                <span>Remind</span>
              </button>
              {showRemind && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-20 min-w-[160px]">
                  {remindMsg ? (
                    <p className="text-xs text-green-600 font-medium">{remindMsg}</p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-500 mb-2 font-medium">Remind me in:</p>
                      {[1, 3, 7].map(d => (
                        <button
                          key={d}
                          onClick={() => handleRemindMe(d)}
                          disabled={remindDays !== null}
                          className="block w-full text-left text-xs text-gray-700 hover:text-accent hover:bg-blue-50 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {d === 1 ? 'Tomorrow' : `In ${d} days`}
                        </button>
                      ))}
                      <button onClick={() => setShowRemind(false)} className="mt-1 text-xs text-gray-300 hover:text-gray-500 px-2 py-1">Cancel</button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Create Calendar Event */}
            <button
              onClick={() => setShowEventModal(s => !s)}
              title="Create calendar event"
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-green-600 px-2 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              <span>Event</span>
            </button>
            {/* Unsubscribe */}
            {unsubUrl && (
              <a
                href={unsubUrl} target="_blank" rel="noreferrer noopener"
                title="Unsubscribe from this sender"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                </svg>
                <span>Unsub</span>
              </a>
            )}
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Delete email"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>Delete</span>
            </button>
          </div>
        </div>

        <div className="mt-2 space-y-1">
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 w-12 flex-shrink-0">From</span>
            <div className="relative">
              <button
                onClick={() => setShowContact(s => !s)}
                className="text-gray-800 hover:text-accent hover:underline text-left"
              >
                {email.sender}
              </button>
              {showContact && (
                <ContactCard
                  sender={email.sender}
                  onClose={() => setShowContact(false)}
                  onSearch={onSearch}
                />
              )}
            </div>
          </div>
          {email.recipients.length > 0 && (
            <div className="flex gap-2 text-sm">
              <span className="text-gray-400 w-12 flex-shrink-0">To</span>
              <span className="text-gray-700">{email.recipients.join(', ')}</span>
            </div>
          )}
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 w-12 flex-shrink-0">Date</span>
            <span className="text-gray-500">{formatDateFull(email.date)}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {email.body_html ? (
          <div
            className="prose prose-base max-w-none text-gray-800 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: email.body_html }}
          />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-loose">
            {email.body || '(empty)'}
          </pre>
        )}
      </div>

      {/* Quick Replies */}
      <div className="px-6 pb-3 flex-shrink-0 border-t border-gray-100">
        {!quickReplies && (
          <button
            onClick={handleLoadReplies}
            disabled={loadingReplies}
            className="mt-3 text-xs text-accent hover:underline flex items-center gap-1 disabled:opacity-50"
          >
            {loadingReplies ? <><span className="animate-spin inline-block">⟳</span> Generating replies…</> : '✦ Generate quick replies'}
          </button>
        )}
        {quickReplies && (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-gray-400 mb-1.5">Quick replies — click to use:</p>
            {([['Short', quickReplies.short], ['Detailed', quickReplies.detailed], ['Formal', quickReplies.formal]] as [string, string][]).map(([label, text]) => text ? (
              <button
                key={label}
                onClick={() => { setReplyBody(text); handleReplyClick() }}
                className="block w-full text-left text-xs bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-accent rounded-lg px-3 py-2 transition-colors"
              >
                <span className="font-medium text-accent mr-1.5">{label}</span>
                <span className="text-gray-600 line-clamp-2">{text}</span>
              </button>
            ) : null)}
            <button onClick={() => setQuickReplies(null)} className="text-xs text-gray-300 hover:text-gray-500 mt-1">Clear</button>
          </div>
        )}
      </div>

      {/* Create Event Modal */}
      {showEventModal && (
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex-shrink-0 animate-slide-up-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Create Calendar Event</h3>
            <button onClick={() => setShowEventModal(false)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
          </div>
          <div className="space-y-2">
            <input value={eventTitle} onChange={e => setEventTitle(e.target.value)} placeholder="Event title"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            <div className="flex gap-2">
              <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
              <input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)}
                className="w-28 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
              <select value={eventDuration} onChange={e => setEventDuration(Number(e.target.value))}
                className="w-24 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white">
                {[0.5,1,1.5,2,3].map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
            <input value={eventAttendees} onChange={e => setEventAttendees(e.target.value)} placeholder="Attendees (comma-separated emails)"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            <div className="flex items-center gap-2 justify-end">
              {eventMsg && <span className={`text-xs ${eventMsg.includes('!') ? 'text-green-600' : 'text-red-500'}`}>{eventMsg}</span>}
              <button onClick={handleCreateEvent} disabled={creatingEvent || !eventTitle || !eventDate}
                className="flex items-center gap-1.5 bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors">
                {creatingEvent ? '⟳ Creating…' : 'Create in Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reply composer */}
      {showCompose && (
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex-shrink-0 animate-slide-up-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Reply</h3>
            <button onClick={() => setShowCompose(false)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-12 flex-shrink-0">To</span>
              <input value={replyTo} onChange={e => setReplyTo(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-12 flex-shrink-0">Subject</span>
              <input value={replySubject} onChange={e => setReplySubject(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            </div>
            <textarea
              value={replyBody}
              onChange={e => setReplyBody(e.target.value)}
              placeholder="Write your reply…"
              rows={4}
              className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent resize-none bg-white"
            />
            <div className="flex items-center gap-2 justify-end">
              {sendMsg && (
                <span className={`text-xs ${sendMsg === 'Sent!' ? 'text-green-600' : 'text-red-500'}`}>{sendMsg}</span>
              )}
              <button
                onClick={handleSend}
                disabled={sending || !replyTo.trim()}
                className="flex items-center gap-1.5 bg-accent text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {sending ? <><span className="animate-spin inline-block">⟳</span> Sending…</> : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
