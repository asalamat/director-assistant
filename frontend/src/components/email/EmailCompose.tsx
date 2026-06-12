import { useState, useRef, useEffect } from 'react'
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

type Signature = { id: number; name: string; content: string; is_default: number; account_id: number }

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
  const [replyCC, setReplyCC] = useState('')
  const [replyBCC, setReplyBCC] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [replySubject, setReplySubject] = useState(initialSubject)
  const [replyBody, setReplyBody] = useState(initialBody)
  const contentRef = useRef<HTMLDivElement>(null)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [adjustingTone, setAdjustingTone] = useState(false)
  const [addingCommitment, setAddingCommitment] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [dictating, setDictating] = useState(false)
  const dictChunksRef = useRef<Blob[]>([])
  const dictRecorderRef = useRef<MediaRecorder | null>(null)
  const [review, setReview] = useState<{
    tone: string; tone_label: 'good' | 'warning' | 'issue'
    unanswered_questions: string[]; commitments: string[]; suggestions: string[]; ready: boolean
  } | null>(null)

  // Undo-send state
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Draft auto-save state
  const DRAFT_KEY = `draft_${email?.id || 'new'}`
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)

  // Signatures state
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [selectedSigId, setSelectedSigId] = useState<number | null>(null)
  const [showSigEditor, setShowSigEditor] = useState(false)
  const [newSigName, setNewSigName] = useState('')
  const [newSigContent, setNewSigContent] = useState('')
  const [savingSig, setSavingSig] = useState(false)

  // Sync external initial values when the compose window opens
  const [lastInitialTo, setLastInitialTo] = useState(initialTo)
  if (initialTo !== lastInitialTo) {
    setLastInitialTo(initialTo)
    setReplyTo(initialTo)
    setReplyCC('')
    setReplyBCC('')
    setShowCcBcc(false)
    setReplySubject(initialSubject)
    setReplyBody(initialBody)
    if (contentRef.current) contentRef.current.innerHTML = initialBody
    setSendMsg('')
    setReview(null)
    setUndoCountdown(null)
    setDraftSavedAt(null)
    setSelectedSigId(null)
  }

  // Sync initialBody to contenteditable after mount (handles Smart Draft + forward)
  useEffect(() => {
    if (show && contentRef.current && initialBody) {
      contentRef.current.innerHTML = initialBody
      setReplyBody(initialBody)
    }
  }, [show, initialBody])

  // Load signatures on open
  useEffect(() => {
    if (!show) return
    api.getSignatures().then(({ signatures: sigs }) => {
      setSignatures(sigs)
      const def = sigs.find(s => s.is_default)
      if (def) setSelectedSigId(def.id)
    }).catch(() => {})
  }, [show])

  // Restore draft on open
  useEffect(() => {
    if (!show) return
    const saved = localStorage.getItem(DRAFT_KEY)
    if (saved) {
      try {
        const d = JSON.parse(saved)
        if (d.body && !replyBody) setReplyBody(d.body)
      } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, DRAFT_KEY])

  // Auto-save draft every 30 seconds
  useEffect(() => {
    if (!show) return
    const save = () => {
      if (replyBody.trim() || replySubject.trim()) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ to: replyTo, subject: replySubject, body: replyBody }))
        setDraftSavedAt(Date.now())
      }
    }
    const id = setInterval(save, 30000)
    return () => { clearInterval(id); save() }
  }, [show, replyTo, replySubject, replyBody, DRAFT_KEY])

  // Hide "Draft saved" indicator after 3 seconds
  useEffect(() => {
    if (draftSavedAt === null) return
    const t = setTimeout(() => setDraftSavedAt(null), 3000)
    return () => clearTimeout(t)
  }, [draftSavedAt])

  // Cleanup countdown on unmount
  useEffect(() => {
    return () => { if (pendingRef.current) clearTimeout(pendingRef.current) }
  }, [])

  const doSend = async () => {
    const body = contentRef.current?.innerHTML || replyBody
    setSending(true)
    setSendMsg('')
    try {
      await api.sendEmail({ to: replyTo, subject: replySubject, body, cc: replyCC || undefined, bcc: replyBCC || undefined, is_html: true })
      localStorage.removeItem(DRAFT_KEY)
      setSendMsg('Sent!')
      setTimeout(() => {
        onClose()
        setSendMsg('')
        setReplyCC('')
        setReplyBCC('')
        setShowCcBcc(false)
        if (contentRef.current) contentRef.current.innerHTML = ''
      }, 1500)
    } catch (e: any) {
      setSendMsg(e.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const handleSend = () => {
    if (!replyTo.trim() || undoCountdown !== null) return
    const countdown = (n: number) => {
      if (n <= 0) {
        setUndoCountdown(null)
        doSend()
        return
      }
      setUndoCountdown(n)
      pendingRef.current = setTimeout(() => countdown(n - 1), 1000)
    }
    countdown(5)
  }

  const cancelSend = () => {
    if (pendingRef.current) clearTimeout(pendingRef.current)
    setUndoCountdown(null)
  }

  const handleAdjustTone = async (tone: string) => {
    if (!replyBody.trim() || adjustingTone) return
    setAdjustingTone(true)
    try {
      const { result } = await api.adjustTone(replyBody, tone as any)
      if (result) {
        setReplyBody(result)
        if (contentRef.current) contentRef.current.innerHTML = result
      }
    } catch {} finally { setAdjustingTone(false) }
  }

  const handleReview = async () => {
    if (!replyBody.trim() || reviewing) return
    setReviewing(true)
    setReview(null)
    try {
      const result = await api.preSendReview({
        to: replyTo, subject: replySubject, body: replyBody,
        original_email_id: email.id,
      })
      setReview(result)
    } catch { /* silent */ }
    setReviewing(false)
  }

  const startDictation = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      dictChunksRef.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => { if (e.data.size > 0) dictChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(dictChunksRef.current, { type: 'audio/webm' })
        try {
          const form = new FormData()
          form.append('audio', blob, 'dictation.webm')
          const r = await fetch('/api/meeting/transcribe', { method: 'POST', body: form }).then(res => res.json())
          if (r.transcript) {
            setReplyBody(prev => prev ? prev + ' ' + r.transcript : r.transcript)
          }
        } catch { /* silent */ }
        setDictating(false)
      }
      mr.start()
      dictRecorderRef.current = mr
      setDictating(true)
    } catch { setDictating(false) }
  }

  const stopDictation = () => {
    dictRecorderRef.current?.stop()
  }

  const handleAddCommitment = async (c: string) => {
    setAddingCommitment(c)
    try {
      await api.addActionItem(email.id, email.subject || '', [c])
    } catch {}
    onCommitmentsChange?.(draftCommitments.filter(x => x !== c))
    setAddingCommitment(null)
  }

  const applySignature = (sigId: number | null) => {
    setSelectedSigId(sigId)
    if (sigId === null) return
    const sig = signatures.find(s => s.id === sigId)
    if (!sig) return
    // Remove any previously appended signature (everything after \n\n--\n)
    const body = replyBody.replace(/\n\n--\n[\s\S]*$/, '')
    setReplyBody(body + '\n\n--\n' + sig.content)
  }

  const handleSaveSig = async () => {
    if (!newSigName.trim() || !newSigContent.trim()) return
    setSavingSig(true)
    try {
      await api.createSignature({ name: newSigName.trim(), content: newSigContent.trim(), is_default: false })
      const { signatures: sigs } = await api.getSignatures()
      setSignatures(sigs)
      setNewSigName('')
      setNewSigContent('')
      setShowSigEditor(false)
    } catch { /* silent */ } finally { setSavingSig(false) }
  }

  const handleDeleteSig = async (id: number) => {
    try {
      await api.deleteSignature(id)
      setSignatures(prev => prev.filter(s => s.id !== id))
      if (selectedSigId === id) setSelectedSigId(null)
    } catch { /* silent */ }
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
            <button onClick={() => setShowCcBcc(v => !v)} className="text-[10px] text-gray-400 hover:text-accent flex-shrink-0">CC/BCC</button>
          </div>
          {showCcBcc && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-12 flex-shrink-0">CC</span>
                <input value={replyCC} onChange={e => setReplyCC(e.target.value)}
                  placeholder="cc@example.com, another@example.com"
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-12 flex-shrink-0">BCC</span>
                <input value={replyBCC} onChange={e => setReplyBCC(e.target.value)}
                  placeholder="bcc@example.com"
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
              </div>
            </>
          )}
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
          {/* Rich text toolbar */}
          <div className="flex gap-0.5 px-1 py-1 border border-gray-200 rounded-t-lg bg-gray-50 flex-wrap">
            {[
              { cmd: 'bold',      icon: 'B', cls: 'font-bold' },
              { cmd: 'italic',    icon: 'I', cls: 'italic' },
              { cmd: 'underline', icon: 'U', cls: 'underline' },
            ].map(({ cmd, icon, cls }) => (
              <button key={cmd} type="button"
                onMouseDown={e => { e.preventDefault(); document.execCommand(cmd, false) }}
                className={`text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600 ${cls}`}
                title={cmd.charAt(0).toUpperCase() + cmd.slice(1)}>
                {icon}
              </button>
            ))}
            <div className="w-px bg-gray-300 mx-0.5 self-stretch" />
            <button type="button"
              onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList', false) }}
              className="text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600" title="Bullet list">
              ≡
            </button>
            <button type="button"
              onMouseDown={e => { e.preventDefault(); document.execCommand('insertOrderedList', false) }}
              className="text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600" title="Numbered list">
              1.
            </button>
            <div className="w-px bg-gray-300 mx-0.5 self-stretch" />
            <button type="button"
              onMouseDown={e => {
                e.preventDefault()
                const url = prompt('Enter URL:')
                if (url) document.execCommand('createLink', false, url)
              }}
              className="text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600" title="Insert link">
              🔗
            </button>
            <button type="button"
              onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat', false) }}
              className="text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600" title="Clear formatting">
              ✕
            </button>
          </div>
          <div
            ref={contentRef}
            contentEditable
            suppressContentEditableWarning
            onInput={() => {
              if (contentRef.current) setReplyBody(contentRef.current.innerHTML)
            }}
            className="w-full min-h-[100px] text-sm border border-gray-200 border-t-0 rounded-b-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white overflow-y-auto"
            style={{ maxHeight: '200px' }}
            data-placeholder="Write your reply…"
          />

          {/* Improve my draft button — rewrites while keeping user's intent */}
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => handleAdjustTone('improve')}
              disabled={adjustingTone || !replyBody.trim()}
              title="AI rewrites your draft — keeps your opinion/disagreement, fixes grammar and clarity"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors font-medium"
            >
              {adjustingTone ? <><span className="animate-spin inline-block text-[10px]">⟳</span> Improving…</> : '✦ Improve my draft'}
            </button>
            <span className="text-[10px] text-gray-400">Keeps your intent · fixes grammar & clarity</span>
          </div>

          {/* Tone + dictation toolbar */}
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-[10px] text-gray-400 self-center mr-1">Adjust tone:</span>
            {(['formal', 'casual', 'shorter', 'friendlier', 'direct'] as const).map(t => (
              <button key={t} onClick={() => handleAdjustTone(t)} disabled={adjustingTone || !replyBody.trim()}
                className="text-[10px] px-2 py-0.5 border border-gray-200 rounded-full hover:bg-gray-100 disabled:opacity-40 capitalize">
                {t}
              </button>
            ))}
            {adjustingTone && <span className="text-[10px] text-gray-400 animate-pulse self-center">rewriting…</span>}
            <button
              onClick={dictating ? stopDictation : startDictation}
              title={dictating ? 'Stop dictation' : 'Dictate reply (Whisper)'}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                dictating
                  ? 'border-red-300 bg-red-50 text-red-600'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-accent'
              }`}
            >
              {dictating ? (
                <><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse inline-block" /> Stop</>
              ) : (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                  </svg>
                  Dictate
                </>
              )}
            </button>
          </div>

          {/* Signature selector */}
          {signatures.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 flex-shrink-0">Signature:</span>
              <select
                value={selectedSigId ?? ''}
                onChange={e => applySignature(e.target.value ? Number(e.target.value) : null)}
                className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">None</option>
                {signatures.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.is_default ? ' (default)' : ''}</option>
                ))}
              </select>
              <button
                onClick={() => setShowSigEditor(v => !v)}
                className="text-[10px] text-accent hover:underline flex-shrink-0"
              >
                Manage
              </button>
            </div>
          )}
          {signatures.length === 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowSigEditor(v => !v)}
                className="text-[10px] text-accent hover:underline"
              >
                + Add signature
              </button>
            </div>
          )}

          {/* Inline signature editor */}
          {showSigEditor && (
            <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-2">
              <p className="text-[11px] font-medium text-gray-600">Signatures</p>
              {signatures.map(s => (
                <div key={s.id} className="flex items-center justify-between text-[11px] text-gray-600 border-b border-gray-100 pb-1">
                  <span className="font-medium">{s.name}</span>
                  <button onClick={() => handleDeleteSig(s.id)} className="text-red-400 hover:text-red-600 text-[10px]">Delete</button>
                </div>
              ))}
              <div className="space-y-1 pt-1">
                <input
                  value={newSigName}
                  onChange={e => setNewSigName(e.target.value)}
                  placeholder="Signature name"
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
                />
                <textarea
                  value={newSigContent}
                  onChange={e => setNewSigContent(e.target.value)}
                  placeholder="Signature content"
                  rows={2}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent resize-none bg-white"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveSig}
                    disabled={savingSig || !newSigName.trim() || !newSigContent.trim()}
                    className="text-[10px] px-2 py-1 bg-accent text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingSig ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setShowSigEditor(false); setNewSigName(''); setNewSigContent('') }}
                    className="text-[10px] px-2 py-1 border border-gray-200 rounded text-gray-500 hover:bg-gray-50"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Draft saved indicator */}
          {draftSavedAt !== null && (
            <p className="text-[10px] text-gray-400">Draft saved</p>
          )}

          {/* Send controls */}
          <div className="flex items-center gap-2 justify-end">
            {sendMsg && (
              <span className={`text-xs ${sendMsg === 'Sent!' ? 'text-green-600' : 'text-red-500'}`}>{sendMsg}</span>
            )}
            <button
              onClick={handleReview}
              disabled={reviewing || !replyBody.trim()}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition-colors"
            >
              {reviewing ? <><span className="animate-spin inline-block text-[10px]">⟳</span> Reviewing…</> : '🔍 Review'}
            </button>
            {undoCountdown !== null ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Sending in {undoCountdown}s…</span>
                <button
                  onClick={cancelSend}
                  className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Undo
                </button>
              </div>
            ) : (
              <button
                onClick={handleSend}
                disabled={sending || !replyTo.trim()}
                className={`flex items-center gap-1.5 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-60 transition-colors ${
                  review?.ready ? 'bg-green-600 hover:bg-green-700' : 'bg-accent hover:bg-blue-700'
                }`}
              >
                {sending ? <><span className="animate-spin inline-block">⟳</span> Sending…</> : review?.ready ? '✓ Send' : 'Send'}
              </button>
            )}
          </div>

          {/* Pre-send review panel */}
          {review && (
            <div className={`rounded-lg border p-3 text-xs space-y-2 ${
              review.tone_label === 'good' ? 'border-green-200 bg-green-50' :
              review.tone_label === 'issue' ? 'border-red-200 bg-red-50' :
              'border-amber-200 bg-amber-50'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span>{review.tone_label === 'good' ? '✅' : review.tone_label === 'issue' ? '⚠️' : '💡'}</span>
                  <span className={`font-medium ${
                    review.tone_label === 'good' ? 'text-green-800' :
                    review.tone_label === 'issue' ? 'text-red-800' : 'text-amber-800'
                  }`}>{review.tone}</span>
                </div>
                <button onClick={() => setReview(null)} className="text-gray-400 hover:text-gray-600 text-[10px]">✕</button>
              </div>
              {review.unanswered_questions.length > 0 && (
                <div>
                  <p className="font-semibold text-red-700 mb-1">Unanswered questions:</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    {review.unanswered_questions.map((q, i) => <li key={i} className="text-red-700">{q}</li>)}
                  </ul>
                </div>
              )}
              {review.commitments.length > 0 && (
                <div>
                  <p className="font-semibold text-gray-600 mb-1">Commitments in this draft:</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    {review.commitments.map((c, i) => <li key={i} className="text-gray-600">{c}</li>)}
                  </ul>
                </div>
              )}
              {review.suggestions.length > 0 && (
                <div>
                  <p className="font-semibold text-amber-700 mb-1">Suggestions:</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    {review.suggestions.map((s, i) => <li key={i} className="text-amber-700">{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
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
