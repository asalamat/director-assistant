import { useState, useEffect } from 'react'
import type { EmailMessage } from '../types'
import { EmptyState, Spinner } from './ui'
import { api } from '../api/client'
import { EmailHeader } from './email/EmailHeader'
import { EmailCompose } from './email/EmailCompose'
import { EmailTools } from './email/EmailTools'

function splitBodyAndQuotes(body: string): { main: string; quoted: string | null } {
  const lines = body.split('\n')
  const quoteStartPatterns = [
    /^>{1}/,
    /^-{3,}\s*(Original|Forwarded)/i,
    /^On .{10,} wrote:/,
    /^_{3,}$/,
    /^From:\s+.+@/i,
  ]

  let quoteStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (quoteStartPatterns.some(p => p.test(lines[i].trim()))) {
      const nextFew = lines.slice(i, i + 3)
      const quotyCount = nextFew.filter(l => l.trim().startsWith('>') || l.trim() === '' || /^(From|To|Sent|Subject):/i.test(l)).length
      if (quotyCount >= 2 || lines[i].trim().startsWith('>')) {
        quoteStart = i
        break
      }
    }
  }

  if (quoteStart <= 2) return { main: body, quoted: null }

  const main = lines.slice(0, quoteStart).join('\n').trimEnd()
  const quoted = lines.slice(quoteStart).join('\n')
  return { main, quoted }
}

interface Props {
  email: EmailMessage | null
  loading: boolean
  fetchError?: string
  onAnalyze: () => void
  analyzing: boolean
  onDelete: (id: string) => void
  onSnooze?: (emailId: string, wakeDate: string) => void
  onAsk?: () => void
  onSearch?: (q: string) => void
}

export function EmailViewer({ email, loading, fetchError, onAnalyze, analyzing, onDelete, onSnooze, onAsk, onSearch }: Props) {
  const [showCompose, setShowCompose] = useState(false)
  const [composeInitialTo, setComposeInitialTo] = useState('')
  const [composeInitialSubject, setComposeInitialSubject] = useState('')
  const [composeInitialBody, setComposeInitialBody] = useState('')
  const [sendTimeSuggestion, setSendTimeSuggestion] = useState<string | null>(null)
  const [draftCommitments, setDraftCommitments] = useState<string[]>([])
  const [translation, setTranslation] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [showQuoted, setShowQuoted] = useState(false)
  const [attachments, setAttachments] = useState<{filename: string; content_type: string}[]>([])
  const [showDelegatePrompt, setShowDelegatePrompt] = useState<{to: string; emailId: string; subject: string} | null>(null)
  const [thread, setThread] = useState<{id: string; subject: string; sender: string; date: string; body: string}[]>([])
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setShowCompose(false)
    setComposeInitialTo('')
    setComposeInitialSubject('')
    setComposeInitialBody('')
    setSendTimeSuggestion(null)
    setDraftCommitments([])
    setTranslation(null)
    setShowQuoted(false)
    setAttachments([])
    setShowDelegatePrompt(null)
    setThread([])
    setExpandedThreadIds(new Set())
    if (email?.id) {
      api.listAttachments(email.id).then(r => setAttachments(r.attachments)).catch(() => setAttachments([]))
      api.getEmailThread(email.id)
        .then(r => setThread(r.thread))
        .catch(() => setThread([]))
    }
  }, [email?.id])

  const handleReplyClick = () => {
    if (!email) return
    const senderEmail = email.sender.match(/<([^>]+)>/)?.[1] || email.sender
    setComposeInitialTo(senderEmail)
    setComposeInitialSubject(`Re: ${email.subject || ''}`)
    setComposeInitialBody('')
    setShowCompose(true)
    if (senderEmail) {
      api.getBestSendTime(senderEmail).then(r => {
        if (r.suggestion) setSendTimeSuggestion(r.suggestion)
      }).catch(() => {})
    }
  }

  const handleForward = () => {
    if (!email) return
    const fwdSubject = email.subject?.startsWith('Fwd: ') ? email.subject : `Fwd: ${email.subject || ''}`
    const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${email.sender}\nDate: ${email.date || ''}\nSubject: ${email.subject || ''}\n\n${email.body || ''}`
    setComposeInitialTo('')
    setComposeInitialSubject(fwdSubject)
    setComposeInitialBody(fwdBody)
    setShowCompose(true)
    setShowDelegatePrompt({ to: '', emailId: email.id, subject: email.subject || '' })
  }

  const handleOpenCompose = (to: string, subject: string, body = '') => {
    setComposeInitialTo(to)
    setComposeInitialSubject(subject)
    setComposeInitialBody(body)
    setShowCompose(true)
    // Extract commitments for smart drafts
    if (email && body) {
      api.extractCommitments(email.id, body).then(res => {
        if (res.commitments.length > 0) setDraftCommitments(res.commitments)
      }).catch(() => {})
    }
  }

  const handleArchive = async () => {
    if (!email) return
    try {
      await api.moveEmail(email.id, 'Archive')
      onDelete(email.id)
    } catch { /* silent */ }
  }

  const handleTranslate = async () => {
    if (!email || translating) return
    setTranslating(true)
    setTranslation(null)
    try {
      const cfg = await api.getConfig().catch(() => null)
      const lang = cfg?.translation_language || 'English'
      const r = await api.translateEmail(email.id, lang)
      setTranslation(r.translation || `(No translation returned for ${lang})`)
    } catch (err: any) {
      setTranslation(`✗ Translation failed: ${err.message || 'Unknown error'}`)
    } finally { setTranslating(false) }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="md" />
          <p className="text-sm text-gray-400">Loading email…</p>
        </div>
      </div>
    )
  }

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <EmptyState
          icon={<svg className="w-10 h-10 text-accent-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
          </svg>}
          title={fetchError ? 'Could not load email' : 'Select an email'}
          description={fetchError || 'AI analysis, replies, and insights await'}
          size="md"
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
      <EmailHeader
        email={email}
        analyzing={analyzing}
        onAnalyze={onAnalyze}
        onDelete={onDelete}
        onSnooze={onSnooze}
        onAsk={onAsk}
        onSearch={onSearch}
        onReplyClick={handleReplyClick}
        onForwardClick={handleForward}
        onTranslate={handleTranslate}
        translating={translating}
        onArchive={handleArchive}
      />

      {thread.length > 0 && (
        <div className="px-6 pt-4 pb-0 space-y-1 flex-shrink-0">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-2">
            {thread.length} earlier message{thread.length !== 1 ? 's' : ''} in this thread
          </p>
          {thread.map(t => {
            const isExpanded = expandedThreadIds.has(t.id)
            const senderName = t.sender.replace(/<[^>]+>/, '').trim().split(' ')[0] || t.sender
            return (
              <div key={t.id} className={`border rounded-xl transition-all ${isExpanded ? 'border-gray-200' : 'border-gray-100 hover:border-gray-200'}`}>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 text-left"
                  onClick={() => {
                    setExpandedThreadIds(prev => {
                      const next = new Set(prev)
                      isExpanded ? next.delete(t.id) : next.add(t.id)
                      return next
                    })
                  }}
                >
                  <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {senderName.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-700 font-medium flex-1 truncate">{senderName}</span>
                  {!isExpanded && (
                    <span className="text-xs text-gray-400 truncate max-w-[200px]">{t.body.slice(0, 60)}…</span>
                  )}
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {t.date ? new Date(t.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                  </span>
                  <span className="text-gray-400 text-xs flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </button>
                {isExpanded && (
                  <div className="px-3 pb-3 border-t border-gray-100">
                    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed max-h-48 overflow-y-auto mt-2">
                      {t.body || '(empty)'}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
          <div className="border-t border-gray-100 mt-2" />
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {email.body_html ? (
          <div
            className="prose prose-base max-w-none text-gray-800 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: email.body_html }}
          />
        ) : (
          (() => {
            const { main, quoted } = splitBodyAndQuotes(email.body || '')
            return (
              <>
                <div className="whitespace-pre-wrap break-words text-sm text-gray-800 leading-relaxed">
                  {main || '(empty)'}
                </div>
                {quoted && (
                  <div className="mt-3">
                    <button
                      onClick={() => setShowQuoted(v => !v)}
                      className="text-xs text-gray-400 hover:text-accent border border-gray-200 rounded px-2 py-0.5 transition-colors"
                    >
                      {showQuoted ? '▲ Hide quoted text' : '▼ Show quoted text'}
                    </button>
                    {showQuoted && (
                      <div className="mt-2 pl-3 border-l-2 border-gray-200 text-xs text-gray-500 whitespace-pre-wrap leading-relaxed opacity-80">
                        {quoted}
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          })()
        )}
      </div>

      {attachments.length > 0 && (
        <div className="px-6 py-2 border-t border-gray-100 flex flex-wrap gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-gray-400 self-center flex-shrink-0">📎</span>
          {attachments.map((att, i) => (
            <span key={i}
              className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2.5 py-1 font-mono border border-gray-200 cursor-default"
              title={`${att.content_type}`}
            >
              {att.filename}
            </span>
          ))}
        </div>
      )}

      {showDelegatePrompt && (
        <div className="px-6 py-2 bg-amber-50 border-t border-amber-100 flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-amber-700">Track this delegation?</span>
          <input value={showDelegatePrompt.to} onChange={e => setShowDelegatePrompt(p => p ? {...p, to: e.target.value} : null)}
            placeholder="delegated to (email)"
            className="flex-1 text-xs border border-amber-200 rounded px-2 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"/>
          <button onClick={async () => {
            if (showDelegatePrompt?.to) {
              await api.createDelegation({ email_id: showDelegatePrompt.emailId, subject: showDelegatePrompt.subject, original_sender: email?.sender || '', delegated_to: showDelegatePrompt.to }).catch(() => {})
            }
            setShowDelegatePrompt(null)
          }} className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded hover:bg-amber-600">Track</button>
          <button onClick={() => setShowDelegatePrompt(null)} className="text-xs text-gray-400 hover:text-gray-600">Skip</button>
        </div>
      )}

      <EmailTools
        email={email}
        translation={translation}
        onClearTranslation={() => setTranslation(null)}
        onOpenCompose={handleOpenCompose}
      />

      <EmailCompose
        email={email}
        show={showCompose}
        onClose={() => setShowCompose(false)}
        initialTo={composeInitialTo}
        initialSubject={composeInitialSubject}
        initialBody={composeInitialBody}
        sendTimeSuggestion={sendTimeSuggestion}
        draftCommitments={draftCommitments}
        onCommitmentsChange={setDraftCommitments}
      />
    </div>
  )
}
