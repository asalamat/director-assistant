import { useState, useEffect } from 'react'
import type { EmailMessage } from '../types'
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

  useEffect(() => {
    setShowCompose(false)
    setSendMsg('')
  }, [email?.id])

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
