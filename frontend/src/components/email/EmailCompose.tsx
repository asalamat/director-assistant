import { useState } from 'react'
import type { EmailMessage } from '../../types'
import { api } from '../../api/client'

export interface EmailComposeProps {
  email: EmailMessage
  show: boolean
  onClose: () => void
  initialTo?: string
  initialSubject?: string
  initialBody?: string
  sendTimeSuggestion?: string | null
  draftCommitments?: string[]
  onCommitmentsChange?: (commitments: string[]) => void
}

export function EmailCompose({
  email,
  show,
  onClose,
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  sendTimeSuggestion,
  draftCommitments = [],
  onCommitmentsChange,
}: EmailComposeProps) {
  const [replyTo, setReplyTo] = useState(initialTo)
  const [replySubject, setReplySubject] = useState(initialSubject)
  const [replyBody, setReplyBody] = useState(initialBody)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [adjustingTone, setAdjustingTone] = useState(false)
  const [addingCommitment, setAddingCommitment] = useState<string | null>(null)

  // Sync external initial values when the compose window opens
  // (parent controls open/close and may pass new values)
  const [lastInitialTo, setLastInitialTo] = useState(initialTo)
  if (initialTo !== lastInitialTo) {
    setLastInitialTo(initialTo)
    setReplyTo(initialTo)
    setReplySubject(initialSubject)
    setReplyBody(initialBody)
    setSendMsg('')
  }

  const handleSend = async () => {
    if (!replyTo.trim()) return
    setSending(true)
    setSendMsg('')
    try {
      await api.sendEmail({ to: replyTo, subject: replySubject, body: replyBody })
      setSendMsg('Sent!')
      setTimeout(() => { onClose(); setSendMsg('') }, 1500)
    } catch (e: any) {
      setSendMsg(e.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const handleAdjustTone = async (tone: string) => {
    if (!replyBody.trim() || adjustingTone) return
    setAdjustingTone(true)
    try {
      const { result } = await api.adjustTone(replyBody, tone as any)
      if (result) setReplyBody(result)
    } catch {} finally { setAdjustingTone(false) }
  }

  const handleAddCommitment = async (c: string) => {
    setAddingCommitment(c)
    try {
      await api.addActionItem(email.id, email.subject || '', [c])
    } catch {}
    onCommitmentsChange?.(draftCommitments.filter(x => x !== c))
    setAddingCommitment(null)
  }

  if (!show) return null

  return (
    <>
      {/* Reply composer */}
      <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex-shrink-0 animate-slide-up-in">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">Reply</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-12 flex-shrink-0">To</span>
            <input value={replyTo} onChange={e => setReplyTo(e.target.value)}
              className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
          </div>
          {sendTimeSuggestion && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">
              <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
              <span>Best time to send: <strong>{sendTimeSuggestion}</strong></span>
            </div>
          )}
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
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-[10px] text-gray-400 self-center mr-1">Adjust tone:</span>
            {(['formal', 'casual', 'shorter', 'friendlier', 'direct'] as const).map(t => (
              <button key={t} onClick={() => handleAdjustTone(t)} disabled={adjustingTone || !replyBody.trim()}
                className="text-[10px] px-2 py-0.5 border border-gray-200 rounded-full hover:bg-gray-100 disabled:opacity-40 capitalize">
                {t}
              </button>
            ))}
            {adjustingTone && <span className="text-[10px] text-gray-400 animate-pulse self-center">rewriting…</span>}
          </div>
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

      {/* Draft commitments */}
      {draftCommitments.length > 0 && (
        <div className="px-6 py-2 bg-amber-50 border-t border-amber-100 flex-shrink-0">
          <p className="text-xs font-medium text-amber-700 mb-1">Commitments detected in draft — add to action board?</p>
          <div className="flex flex-wrap gap-1.5">
            {draftCommitments.map((c, i) => (
              <button key={i} onClick={() => handleAddCommitment(c)} disabled={addingCommitment === c}
                className="text-xs bg-white border border-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100 text-amber-800 flex items-center gap-1">
                {addingCommitment === c ? '…' : '+'} {c}
              </button>
            ))}
            <button onClick={() => onCommitmentsChange?.([])} className="text-xs text-gray-300 hover:text-gray-500 self-center ml-1">dismiss</button>
          </div>
        </div>
      )}
    </>
  )
}
