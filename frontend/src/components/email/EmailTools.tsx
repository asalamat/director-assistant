import { useState, useRef } from 'react'
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
  const [attachAnalysis, setAttachAnalysis] = useState<{
    attachments: {filename: string; type: string; summary: string}[]
    insights: {key: string; value: string; label: string}[]
  } | null>(null)
  const [analyzingAttach, setAnalyzingAttach] = useState(false)
  const [financialData, setFinancialData] = useState<any | null>(null)
  const [extractingFinancials, setExtractingFinancials] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

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

  const handleAnalyzeAttachments = async () => {
    if (analyzingAttach) return
    setAnalyzingAttach(true)
    try {
      const r = await api.analyzeAttachments(email.id)
      if (r.has_attachments) setAttachAnalysis(r)
      else setAttachAnalysis({ attachments: [], insights: [] })
    } catch { /* silent */ }
    setAnalyzingAttach(false)
  }

  const handleExtractFinancials = async () => {
    if (extractingFinancials) return
    setExtractingFinancials(true)
    try {
      const data = await api.extractFinancials(email.id)
      setFinancialData(data)
    } catch { /* silent */ }
    setExtractingFinancials(false)
  }

  const downloadCSV = () => {
    if (!financialData) return
    const headers = ['Type','Vendor','Amount','Currency','Date','Due Date','Description','Reference']
    const values = [
      financialData.type, financialData.vendor, financialData.amount, financialData.currency,
      financialData.date, financialData.due_date, financialData.description, financialData.reference
    ].map(v => `"${(v||'').toString().replace(/"/g,'""')}"`)
    const csv = headers.join(',') + '\n' + values.join(',')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${financialData.type || 'financial'}-${financialData.date || 'extract'}.csv`
    a.click()
  }

  const handleReadAloud = () => {
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    const audio = new Audio(api.readEmailAloud(email.id))
    audio.onended = () => setPlaying(false)
    audio.onerror = () => setPlaying(false)
    audio.play().then(() => setPlaying(true)).catch(() => {})
    audioRef.current = audio
  }

  const handleQuickReplyClick = (body: string) => {
    const senderEmail = email.sender.match(/<([^>]+)>/)?.[1] || email.sender
    onOpenCompose(senderEmail, `Re: ${email.subject || ''}`, body)
  }

  return (
    <>
      {/* Translation panel */}
      {translation && (
        <div className="mx-6 mb-3 bg-white border border-indigo-200 rounded-xl p-4 shadow-card">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-base">🌐</span>
              <p className="text-xs font-semibold text-indigo-700">Translation</p>
            </div>
            <button onClick={onClearTranslation}
              className="text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-1.5 py-0.5 text-xs transition-colors">✕ Close</button>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{translation}</p>
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
          <button onClick={handleAnalyzeAttachments} disabled={analyzingAttach}
            className="text-xs text-amber-600 hover:underline flex items-center gap-1 disabled:opacity-50">
            {analyzingAttach ? <><span className="animate-spin inline-block">⟳</span> Analyzing…</> : '📎 Attachments'}
          </button>
          <button onClick={handleExtractFinancials} disabled={extractingFinancials}
            className="text-xs text-green-600 hover:underline flex items-center gap-1 disabled:opacity-50">
            {extractingFinancials ? <><span className="animate-spin inline-block">⟳</span> Extracting…</> : '💰 Extract'}
          </button>
          <button onClick={handleReadAloud}
            title={playing ? 'Stop' : 'Read aloud (ElevenLabs)'}
            className={`text-xs px-2 py-1 rounded border transition-colors ${playing ? 'border-red-200 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-accent'}`}>
            {playing ? '⏹ Stop' : '🔊 Read'}
          </button>
        </div>

        {attachAnalysis !== null && (
          <div className="mt-3 bg-white border border-indigo-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-base">📎</span>
                <p className="text-xs font-semibold text-indigo-700">Attachment Intelligence</p>
              </div>
              <button onClick={() => setAttachAnalysis(null)}
                className="text-gray-500 hover:text-gray-800 text-xs px-1 rounded hover:bg-gray-100 transition-colors">✕</button>
            </div>
            {attachAnalysis.attachments.length === 0 && attachAnalysis.insights.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No attachment references detected in this email.</p>
            ) : (
              <>
                {attachAnalysis.attachments.length > 0 && (
                  <div className="space-y-1.5">
                    {attachAnalysis.attachments.map((a, i) => {
                      const badgeColors: Record<string, string> = {
                        invoice: 'bg-yellow-100 text-yellow-800',
                        contract: 'bg-indigo-100 text-indigo-800',
                        proposal: 'bg-blue-100 text-blue-800',
                        report: 'bg-purple-100 text-purple-800',
                        receipt: 'bg-green-100 text-green-800',
                        other: 'bg-gray-100 text-gray-700',
                      }
                      const badge = badgeColors[a.type?.toLowerCase()] ?? badgeColors.other
                      return (
                        <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${badge}`}>
                            {(a.type || 'file').toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-800 truncate">{a.filename}</p>
                            {a.summary && <p className="text-xs text-gray-500 mt-0.5">{a.summary}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {attachAnalysis.insights.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-indigo-100">
                    {attachAnalysis.insights.map((ins, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5 text-xs text-indigo-800">
                        <span className="font-medium text-indigo-500">{ins.label}:</span>
                        {ins.value}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {financialData && (
          <div className="mt-3 bg-white border border-green-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-base">💰</span>
                <p className="text-xs font-semibold text-green-700">Financial Extract</p>
                {financialData.type && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-800 uppercase">
                    {financialData.type}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={downloadCSV}
                  className="text-xs text-green-700 hover:text-green-900 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg px-2 py-0.5 transition-colors">
                  ↓ CSV
                </button>
                <button onClick={() => setFinancialData(null)}
                  className="text-gray-500 hover:text-gray-800 text-xs px-1 rounded hover:bg-gray-100 transition-colors">✕</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Vendor', value: financialData.vendor },
                { label: 'Amount', value: financialData.amount },
                { label: 'Currency', value: financialData.currency },
                { label: 'Date', value: financialData.date },
                { label: 'Due', value: financialData.due_date },
                { label: 'Ref', value: financialData.reference },
              ].filter(f => f.value).map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-green-50 border border-green-100 rounded-full px-2 py-0.5 text-xs text-green-800">
                  <span className="font-medium text-green-500">{f.label}:</span>
                  {f.value}
                </span>
              ))}
            </div>
            {financialData.description && (
              <p className="text-xs text-gray-600 border-t border-green-100 pt-2">{financialData.description}</p>
            )}
            {financialData.parties?.length > 0 && (
              <p className="text-xs text-gray-500">
                <span className="font-medium">Parties:</span> {financialData.parties.join(' · ')}
              </p>
            )}
            {financialData.key_terms?.length > 0 && (
              <p className="text-xs text-gray-500">
                <span className="font-medium">Terms:</span> {financialData.key_terms.join(' · ')}
              </p>
            )}
          </div>
        )}

        {threadSummary && (
          <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-emerald-700">Thread Summary ({threadSummary.message_count} messages)</p>
              <button onClick={() => setThreadSummary(null)} className="text-gray-500 hover:text-gray-800 text-xs px-1 rounded hover:bg-gray-100 transition-colors">✕</button>
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
            <button onClick={() => setQuickReplies(null)} className="text-xs text-gray-500 hover:text-gray-700 mt-1 px-2 py-0.5 rounded hover:bg-gray-100 transition-colors">Clear</button>
          </div>
        )}
      </div>
    </>
  )
}
