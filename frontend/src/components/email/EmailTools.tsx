import { useState } from 'react'
import type { EmailMessage, QuickReplies } from '../../types'
import { api } from '../../api/client'

export interface EmailToolsProps {
  email: EmailMessage
  translation: string | null
  onClearTranslation: () => void
  onOpenCompose: (to: string, subject: string, body?: string) => void
}

export function EmailTools({ email, translation, onClearTranslation, onOpenCompose }: EmailToolsProps) {
  const [quickReplies, setQuickReplies] = useState<QuickReplies | null>(null)
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [loadingSmartDraft, setLoadingSmartDraft] = useState(false)
  const [threadSummary, setThreadSummary] = useState<{
    summary: string; key_points: string[]; outcome: string; message_count: number
  } | null>(null)
  const [loadingThreadSummary, setLoadingThreadSummary] = useState(false)

  const handleLoadReplies = async () => {
    if (loadingReplies) return
    setLoadingReplies(true)
    try {
      const r = await api.getQuickReplies(email.id)
      setQuickReplies(r)
    } catch { setQuickReplies({ short: 'Failed to generate', detailed: '', formal: '' }) }
    finally { setLoadingReplies(false) }
  }

  const handleSmartDraft = async () => {
    if (loadingSmartDraft) return
    setLoadingSmartDraft(true)
    try {
      const r = await api.getSmartDraft(email.id)
      onOpenCompose(r.to, r.subject, r.draft)
      api.extractCommitments(email.id, r.draft).then(_res => {
        // commitments are managed in the parent via onOpenCompose callback
      }).catch(() => {})
    } catch { /* silently fail */ }
    finally { setLoadingSmartDraft(false) }
  }

  const handleSummarizeThread = async () => {
    if (loadingThreadSummary) return
    setLoadingThreadSummary(true)
    try {
      const r = await api.summarizeThread(email.id)
      setThreadSummary(r)
    } catch { /* silent */ } finally { setLoadingThreadSummary(false) }
  }

  const handleQuickReplyClick = (body: string) => {
    const senderEmail = email.sender.match(/<([^>]+)>/)?.[1] || email.sender
    onOpenCompose(senderEmail, `Re: ${email.subject || ''}`, body)
  }

  return (
    <>
      {/* Translation panel */}
      {translation && (
        <div className="mx-6 mb-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
          <div className="flex justify-between items-center mb-1">
            <p className="text-xs font-medium text-indigo-700">Translation</p>
            <button onClick={onClearTranslation} className="text-gray-300 hover:text-gray-500 text-xs">✕</button>
          </div>
          <p className="text-xs text-gray-700 whitespace-pre-wrap">{translation}</p>
        </div>
      )}

      {/* Quick Replies + Smart Draft + Thread Summary */}
      <div className="px-6 pb-3 flex-shrink-0 border-t border-gray-100">
        <div className="flex gap-3 mt-3">
          {!quickReplies && (
            <button
              onClick={handleLoadReplies}
              disabled={loadingReplies}
              className="text-xs text-accent hover:underline flex items-center gap-1 disabled:opacity-50"
            >
              {loadingReplies ? <><span className="animate-spin inline-block">⟳</span> Generating…</> : '✦ Quick replies'}
            </button>
          )}
          <button
            onClick={handleSmartDraft}
            disabled={loadingSmartDraft}
            className="text-xs text-purple-600 hover:underline flex items-center gap-1 disabled:opacity-50"
          >
            {loadingSmartDraft ? <><span className="animate-spin inline-block">⟳</span> Drafting…</> : '✎ Smart Draft'}
          </button>
          <button onClick={handleSummarizeThread} disabled={loadingThreadSummary}
            className="text-xs text-emerald-600 hover:underline flex items-center gap-1 disabled:opacity-50">
            {loadingThreadSummary ? <><span className="animate-spin inline-block">⟳</span> Summarizing…</> : '≡ Summarize thread'}
          </button>
        </div>

        {threadSummary && (
          <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-emerald-700">Thread Summary ({threadSummary.message_count} messages)</p>
              <button onClick={() => setThreadSummary(null)} className="text-gray-300 hover:text-gray-500 text-xs">✕</button>
            </div>
            <p className="text-xs text-gray-700">{threadSummary.summary}</p>
            {threadSummary.key_points.length > 0 && (
              <ul className="space-y-0.5">{threadSummary.key_points.map((p, i) => (
                <li key={i} className="text-xs text-gray-600 flex gap-1"><span className="text-emerald-500 flex-shrink-0">•</span>{p}</li>
              ))}</ul>
            )}
            {threadSummary.outcome && (
              <p className="text-xs text-gray-500 italic border-t border-emerald-100 pt-2">{threadSummary.outcome}</p>
            )}
          </div>
        )}

        {quickReplies && (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-gray-400 mb-1.5">Quick replies — click to use:</p>
            {([['Short', quickReplies.short], ['Detailed', quickReplies.detailed], ['Formal', quickReplies.formal]] as [string, string][]).map(([label, text]) => text ? (
              <button
                key={label}
                onClick={() => handleQuickReplyClick(text)}
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
    </>
  )
}
