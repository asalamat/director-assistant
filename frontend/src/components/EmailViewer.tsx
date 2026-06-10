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

  useEffect(() => {
    setShowCompose(false)
    setComposeInitialTo('')
    setComposeInitialSubject('')
    setComposeInitialBody('')
    setSendTimeSuggestion(null)
    setDraftCommitments([])
    setTranslation(null)
    setShowQuoted(false)
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
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      <EmailHeader
        email={email}
        analyzing={analyzing}
        onAnalyze={onAnalyze}
        onDelete={onDelete}
        onSnooze={onSnooze}
        onAsk={onAsk}
        onSearch={onSearch}
        onReplyClick={handleReplyClick}
        onTranslate={handleTranslate}
        translating={translating}
      />

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
