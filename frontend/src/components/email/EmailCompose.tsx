import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'
import type { EmailMessage } from '../../types'
import { api } from '../../api/client'
import { useEmailContext } from '../../contexts/EmailContext'
import { ComposeSignaturePanel } from './ComposeSignaturePanel'
import { ComposeReviewPanel } from './ComposeReviewPanel'
import type { ReviewData } from './ComposeReviewPanel'

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

type Attachment = { name: string; data: string; type: string }

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
  const { mergeRefresh } = useEmailContext()
  const [replyTo, setReplyTo] = useState(initialTo)
  const [replyCC, setReplyCC] = useState('')
  const [replyBCC, setReplyBCC] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [ccSuggestions, setCcSuggestions] = useState<{ email: string; name: string }[]>([])
  const [replySubject, setReplySubject] = useState(initialSubject)
  const [replyBody, setReplyBody] = useState(initialBody)
  const contentRef = useRef<HTMLDivElement>(null)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')
  const [adjustingTone, setAdjustingTone] = useState(false)
  const [draftingFromIdea, setDraftingFromIdea] = useState(false)
  const [addingCommitment, setAddingCommitment] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [dictating, setDictating] = useState(false)
  const dictChunksRef = useRef<Blob[]>([])
  const dictRecorderRef = useRef<MediaRecorder | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)

  // Attachments
  const attachFileRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])

  // Undo-send state
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Draft auto-save state
  const DRAFT_KEY = `draft_${email?.id || 'new'}`
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)

  // From-account state
  const [accounts, setAccounts] = useState<{id: number; username: string; provider: string}[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)

  // Snippets state
  const [snippets, setSnippets] = useState<{id: number; name: string; content: string}[]>([])
  const [showSnippets, setShowSnippets] = useState(false)

  // Update both body state and contenteditable DOM together
  const setBodyContent = (html: string) => {
    setReplyBody(html)
    if (contentRef.current) contentRef.current.innerHTML = html
  }

  // Sync external initial values when the compose window opens
  useEffect(() => {
    setReplyTo(initialTo)
    setReplyCC('')
    setReplyBCC('')
    setShowCcBcc(false)
    setReplySubject(initialSubject)
    const safeInitialBody = DOMPurify.sanitize(initialBody, { USE_PROFILES: { html: true } })
    setReplyBody(safeInitialBody)
    if (contentRef.current) contentRef.current.innerHTML = safeInitialBody
    setSendMsg('')
    setReview(null)
    setUndoCountdown(null)
    setDraftSavedAt(null)
    setAttachments([])
  }, [initialTo, initialSubject, initialBody, show])

  // Sync initialBody to contenteditable after mount (handles Smart Draft + forward)
  useEffect(() => {
    if (show && contentRef.current && initialBody) {
      const safeInitialBody = DOMPurify.sanitize(initialBody, { USE_PROFILES: { html: true } })
      contentRef.current.innerHTML = safeInitialBody
      setReplyBody(safeInitialBody)
    }
  }, [show, initialBody])

  // Load accounts + snippets on open
  useEffect(() => {
    if (!show) return
    api.getAccounts().then(accs => {
      setAccounts(accs)
      if (accs.length === 1) setSelectedAccountId(accs[0].id)
    }).catch(() => {})
    api.getSnippets().then(r => setSnippets(r.snippets)).catch(() => {})
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

  // Smart CC suggestions — debounced when To + Subject are present
  useEffect(() => {
    if (!show || !replyTo.trim() || !replySubject.trim()) {
      setCcSuggestions([])
      return
    }
    const ccAddrs = replyCC.toLowerCase()
    const timer = setTimeout(async () => {
      try {
        const { suggestions } = await api.suggestCC(replyTo.trim(), replySubject.trim())
        setCcSuggestions(suggestions.filter((s: { email: string }) => !ccAddrs.includes(s.email.toLowerCase())))
      } catch { setCcSuggestions([]) }
    }, 800)
    return () => clearTimeout(timer)
  }, [show, replyTo, replySubject, replyCC])

  const addCc = (email: string) => {
    setShowCcBcc(true)
    setReplyCC(prev => (prev.trim() ? `${prev.replace(/,\s*$/, '')}, ${email}` : email))
    setCcSuggestions(prev => prev.filter(s => s.email !== email))
  }

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        setAttachments(prev => [...prev, { name: file.name, data: base64, type: file.type || 'application/octet-stream' }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removeAttachment = (name: string) => {
    setAttachments(prev => prev.filter(a => a.name !== name))
  }

  const doSend = async () => {
    const body = contentRef.current?.innerHTML || replyBody
    setSending(true)
    setSendMsg('')
    try {
      await api.sendEmail({
        to: replyTo, subject: replySubject, body,
        cc: replyCC || undefined, bcc: replyBCC || undefined,
        is_html: true, account_id: selectedAccountId ?? undefined,
        attachments: attachments.length ? attachments : undefined,
      })
      localStorage.removeItem(DRAFT_KEY)
      setSendMsg('Sent!')
      setTimeout(() => {
        onClose()
        mergeRefresh()
        setSendMsg('')
        setReplyCC('')
        setReplyBCC('')
        setShowCcBcc(false)
        setAttachments([])
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
      if (result) setBodyContent(DOMPurify.sanitize(result, { USE_PROFILES: { html: true } }))
    } catch {} finally { setAdjustingTone(false) }
  }

  const handleDraftFromIdea = async () => {
    if (!replyBody.trim() || draftingFromIdea) return
    setDraftingFromIdea(true)
    try {
      const { result } = await api.draftFromIdea(replyBody, replySubject, replyTo)
      if (result) setBodyContent(DOMPurify.sanitize(result, { USE_PROFILES: { html: true } }))
    } catch {} finally { setDraftingFromIdea(false) }
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
            setReplyBody(prev => {
              const next = prev ? prev + ' ' + r.transcript : r.transcript
              if (contentRef.current) contentRef.current.innerHTML = (contentRef.current.innerHTML + ' ' + r.transcript).trim()
              return next
            })
          }
        } catch { /* silent */ }
        setDictating(false)
      }
      mr.start()
      dictRecorderRef.current = mr
      setDictating(true)
    } catch { setDictating(false) }
  }

  const stopDictation = () => { dictRecorderRef.current?.stop() }

  const handleAddCommitment = async (c: string) => {
    setAddingCommitment(c)
    try {
      await api.addActionItem(email.id, email.subject || '', [c])
    } catch {}
    onCommitmentsChange?.(draftCommitments.filter(x => x !== c))
    setAddingCommitment(null)
  }

  const insertSnippet = (content: string) => {
    setShowSnippets(false)
    if (contentRef.current) {
      contentRef.current.focus()
      document.execCommand('insertText', false, content)
      setReplyBody(contentRef.current.innerHTML)
    } else {
      setReplyBody(prev => prev ? prev + '\n' + content : content)
    }
  }

  if (!show) return null

  return (
    <>
      <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur-sm shadow-2xl animate-slide-up-in flex flex-col" style={{ maxHeight: '52vh' }}>
        {/* title bar */}
        <div className="px-6 pt-3 pb-2 flex items-center justify-between flex-shrink-0 border-b border-gray-100 bg-white">
          <h3 className="text-sm font-semibold text-gray-800">↩ Reply</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs px-2 py-1 rounded hover:bg-gray-100">✕ Cancel</button>
        </div>
        {/* scrollable fields */}
        <div className="px-6 py-3 overflow-y-auto flex-1 space-y-2">
          {accounts.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-12 flex-shrink-0">From</span>
              <select
                value={selectedAccountId ?? ''}
                onChange={e => setSelectedAccountId(e.target.value ? Number(e.target.value) : null)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white text-gray-700"
              >
                <option value="">Default account</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.username}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-12 flex-shrink-0">To</span>
            <input value={replyTo} onChange={e => setReplyTo(e.target.value)}
              className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            <button onClick={() => setShowCcBcc(v => !v)} className="text-[10px] text-gray-400 hover:text-accent flex-shrink-0">CC/BCC</button>
          </div>
          {ccSuggestions.length > 0 && (
            <div className="flex items-center flex-wrap gap-1.5 pl-14">
              <span className="text-[10px] text-gray-400">Suggested CC:</span>
              {ccSuggestions.map(s => (
                <span key={s.email} className="flex items-center gap-1 text-[10px] bg-accent/10 text-accent border border-accent/20 rounded-full pl-2 pr-1 py-0.5">
                  <button onClick={() => addCc(s.email)} title={`Add ${s.email} to CC`} className="hover:underline">{s.name || s.email}</button>
                  <button onClick={() => setCcSuggestions(prev => prev.filter(x => x.email !== s.email))} title="Dismiss" className="text-accent/50 hover:text-red-500 font-bold px-0.5">✕</button>
                </span>
              ))}
            </div>
          )}
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
            <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList', false) }}
              className="text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600" title="Bullet list">≡</button>
            <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('insertOrderedList', false) }}
              className="text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600" title="Numbered list">1.</button>
            <div className="w-px bg-gray-300 mx-0.5 self-stretch" />
            <button type="button"
              onMouseDown={e => {
                e.preventDefault()
                const url = prompt('Enter URL:')
                if (url) document.execCommand('createLink', false, url)
              }}
              className="text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600" title="Insert link">🔗</button>
            <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat', false) }}
              className="text-xs px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600" title="Clear formatting">✕</button>
          </div>
          <div
            ref={contentRef}
            contentEditable
            suppressContentEditableWarning
            onInput={() => { if (contentRef.current) setReplyBody(contentRef.current.innerHTML) }}
            className="w-full min-h-[100px] text-sm border border-gray-200 border-t-0 rounded-b-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white overflow-y-auto"
            style={{ maxHeight: '200px' }}
            data-placeholder="Write your reply…"
          />

          {/* Attachments list */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map(a => (
                <span key={a.name} className="flex items-center gap-1 text-[10px] bg-gray-100 border border-gray-200 rounded-full pl-2 pr-1 py-0.5 text-gray-600">
                  <span className="truncate max-w-[140px]" title={a.name}>📎 {a.name}</span>
                  <button onClick={() => removeAttachment(a.name)} className="text-gray-400 hover:text-red-500 font-bold px-0.5">✕</button>
                </span>
              ))}
            </div>
          )}

          {/* AI toolbar — Draft from notes + Improve */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <button onClick={handleDraftFromIdea} disabled={draftingFromIdea || adjustingTone || !replyBody.trim()}
              title="Turn rough notes or bullet points into a complete email"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-40 transition-colors font-medium">
              {draftingFromIdea ? <><span className="animate-spin inline-block text-[10px]">⟳</span> Drafting…</> : '✦ Draft from notes'}
            </button>
            <button onClick={() => handleAdjustTone('improve')} disabled={adjustingTone || draftingFromIdea || !replyBody.trim()}
              title="AI rewrites your draft — keeps your opinion/disagreement, fixes grammar and clarity"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors font-medium">
              {adjustingTone ? <><span className="animate-spin inline-block text-[10px]">⟳</span> Improving…</> : '✦ Improve'}
            </button>
            {(draftingFromIdea || adjustingTone) && <span className="text-[10px] text-gray-400 animate-pulse">rewriting…</span>}
          </div>

          {/* Tone + dictation + snippets + attach toolbar */}
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="text-[10px] text-gray-400 self-center mr-1">Adjust tone:</span>
            {(['formal', 'casual', 'shorter', 'friendlier', 'direct'] as const).map(t => (
              <button key={t} onClick={() => handleAdjustTone(t)} disabled={adjustingTone || draftingFromIdea || !replyBody.trim()}
                className="text-[10px] px-2 py-0.5 border border-gray-200 rounded-full hover:bg-gray-100 disabled:opacity-40 capitalize">
                {t}
              </button>
            ))}
            <button
              onClick={dictating ? stopDictation : startDictation}
              title={dictating ? 'Stop dictation' : 'Dictate reply (Whisper)'}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                dictating ? 'border-red-300 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-accent'
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
            <div className="relative">
              <button type="button" onClick={() => setShowSnippets(v => !v)} disabled={adjustingTone}
                className="text-[10px] px-2 py-0.5 border border-gray-200 rounded-full hover:bg-gray-100 text-gray-500"
                title="Insert a canned response">
                Snippets
              </button>
              {showSnippets && snippets.length > 0 && (
                <div className="absolute bottom-full left-0 mb-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] max-h-48 overflow-y-auto"
                  onMouseLeave={() => setShowSnippets(false)}>
                  {snippets.map(s => (
                    <button key={s.id} onClick={() => insertSnippet(s.content)}
                      className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 border-b border-gray-50 last:border-0">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-gray-400 truncate">{s.content.slice(0, 50)}…</p>
                    </button>
                  ))}
                </div>
              )}
              {showSnippets && snippets.length === 0 && (
                <div className="absolute bottom-full left-0 mb-1 z-20 bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-xs text-gray-400 min-w-[180px]">
                  No snippets yet. Create them in Settings → App Settings.
                </div>
              )}
            </div>
            {/* File attach button */}
            <button type="button" onClick={() => attachFileRef.current?.click()}
              className="text-[10px] px-2 py-0.5 border border-gray-200 rounded-full hover:bg-gray-100 text-gray-500"
              title="Attach a file">
              📎 Attach
            </button>
            <input ref={attachFileRef} type="file" multiple className="hidden" onChange={handleFileAttach} />
          </div>

          <ComposeSignaturePanel show={show} replyBody={replyBody} onBodyChange={setBodyContent} />

          {/* Draft saved indicator */}
          {draftSavedAt !== null && (
            <p className="text-[10px] text-gray-400">Draft saved</p>
          )}

          {review && <ComposeReviewPanel review={review} onDismiss={() => setReview(null)} />}
        </div>

        {/* Draft commitments */}
        {draftCommitments.length > 0 && (
          <div className="px-6 py-2 bg-amber-50 border-t border-amber-100 flex-shrink-0">
            <p className="text-xs font-medium text-amber-700 mb-1">Commitments detected — add to action board?</p>
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

        {/* Sticky send footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-white flex items-center gap-2 justify-end flex-shrink-0">
          {sendMsg && (
            <span className={`text-xs ${sendMsg === 'Sent!' ? 'text-green-600' : 'text-red-500'}`}>{sendMsg}</span>
          )}
          <button onClick={handleReview} disabled={reviewing || !replyBody.trim()}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition-colors">
            {reviewing ? <><span className="animate-spin inline-block text-[10px]">⟳</span> Reviewing…</> : '🔍 Review'}
          </button>
          {undoCountdown !== null ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Sending in {undoCountdown}s…</span>
              <button onClick={cancelSend} className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-100">Undo</button>
            </div>
          ) : (
            <button onClick={handleSend} disabled={sending || !replyTo.trim()}
              className={`flex items-center gap-1.5 text-white text-xs px-4 py-1.5 rounded-lg font-medium disabled:opacity-60 transition-colors ${
                review?.ready ? 'bg-green-600 hover:bg-green-700' : 'bg-accent hover:bg-blue-700'
              }`}>
              {sending ? <><span className="animate-spin inline-block">⟳</span> Sending…</> : review?.ready ? '✓ Send' : 'Send ↑'}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
