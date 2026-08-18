import { useState, useEffect, useRef } from 'react'
import DOMPurify from 'dompurify'
import { api } from '../api/client'
import type { Account } from '../types'
import { useEmailContext } from '../contexts/EmailContext'
import { ToneCoach } from './ToneCoach'
import { VoiceDictation } from './VoiceDictation'

const AI_TONES = ['formal', 'casual', 'shorter', 'friendlier', 'direct'] as const
type AiTone = typeof AI_TONES[number] | 'improve'

const BODY_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// AI endpoints return plain prose (with \n / \n\n breaks). Turn that into real
// paragraph markup so it doesn't collapse into one line inside contentEditable
// or in the sent HTML email.
function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .split(/\n\s*\n/)
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => `<p style="margin:0 0 1em 0">${para.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

interface Props {
  open: boolean
  onClose: () => void
  accounts: Account[]
  initialTo?: string
  initialSubject?: string
  initialBody?: string
}

export function ComposeModal({ open, onClose, accounts, initialTo = '', initialSubject = '', initialBody = '' }: Props) {
  const { mergeRefresh } = useEmailContext()
  const [to, setTo] = useState(initialTo)
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [accountId, setAccountId] = useState<number>(accounts[0]?.id ?? 0)
  const [showCc, setShowCc] = useState(false)
  const [ccSuggestions, setCcSuggestions] = useState<{ email: string; name: string }[]>([])
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')
  const [adjustingTone, setAdjustingTone] = useState(false)
  const [draftingFromIdea, setDraftingFromIdea] = useState(false)
  const toRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Update both body state and the contenteditable DOM together
  const setBodyContent = (html: string) => {
    setBody(html)
    if (contentRef.current) contentRef.current.innerHTML = html
  }

  useEffect(() => {
    if (open) {
      setTo(initialTo)
      setSubject(initialSubject)
      setCc('')
      const safeInitialBody = DOMPurify.sanitize(
        initialBody.includes('<') ? initialBody : plainTextToHtml(initialBody),
        { USE_PROFILES: { html: true } }
      )
      setBody(safeInitialBody)
      if (contentRef.current) contentRef.current.innerHTML = safeInitialBody
      setMsg('')
      setSending(false)
      setTimeout(() => toRef.current?.focus(), 50)
    }
  }, [open, initialTo, initialSubject, initialBody])

  useEffect(() => {
    if (accounts.length > 0 && (!accountId || accountId === 0)) {
      setAccountId(accounts[0].id)
    }
  }, [accounts])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Smart CC suggestions — debounced when To + Subject are present
  useEffect(() => {
    if (!open || !to.trim() || !subject.trim()) {
      setCcSuggestions([])
      return
    }
    const ccAddrs = cc.toLowerCase()
    const timer = setTimeout(async () => {
      try {
        const { suggestions } = await api.suggestCC(to.trim(), subject.trim())
        setCcSuggestions(suggestions.filter(s => !ccAddrs.includes(s.email.toLowerCase())))
      } catch { setCcSuggestions([]) }
    }, 800)
    return () => clearTimeout(timer)
  }, [open, to, subject, cc])

  const addCc = (email: string) => {
    setShowCc(true)
    setCc(prev => (prev.trim() ? `${prev.replace(/,\s*$/, '')}, ${email}` : email))
    setCcSuggestions(prev => prev.filter(s => s.email !== email))
  }

  const handleDraftFromIdea = async () => {
    if (!body.trim() || draftingFromIdea) return
    setDraftingFromIdea(true)
    try {
      const { result } = await api.draftFromIdea(body, subject, to)
      if (result) setBodyContent(DOMPurify.sanitize(plainTextToHtml(result), { USE_PROFILES: { html: true } }))
    } catch { /* silent */ } finally { setDraftingFromIdea(false) }
  }

  const handleAdjustTone = async (tone: AiTone) => {
    if (!body.trim() || adjustingTone) return
    setAdjustingTone(true)
    try {
      const { result } = await api.adjustTone(body, tone)
      if (result) setBodyContent(DOMPurify.sanitize(plainTextToHtml(result), { USE_PROFILES: { html: true } }))
    } catch { /* silent */ } finally { setAdjustingTone(false) }
  }

  const handleSend = async () => {
    if (!to.trim() || !subject.trim()) {
      setMsg('To and Subject are required.')
      return
    }
    setSending(true)
    setMsg('')
    try {
      const html = contentRef.current?.innerHTML || body
      await api.sendEmail({ to, cc: cc || undefined, subject, body: html, is_html: true, account_id: accountId })
      setMsg('Sent!')
      setTimeout(() => { onClose(); mergeRefresh() }, 1200)
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">New Email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Fields */}
        <div className="flex flex-col divide-y divide-gray-100">
          <div className="flex items-center px-5 py-2.5 gap-3">
            <span className="text-xs text-gray-400 w-10">To</span>
            <input
              ref={toRef}
              type="text"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"
            />
            <button
              onClick={() => setShowCc(s => !s)}
              className="text-xs text-gray-400 hover:text-accent"
            >Cc</button>
          </div>

          {ccSuggestions.length > 0 && (
            <div className="flex items-center flex-wrap gap-1.5 px-5 py-2">
              <span className="text-[11px] text-gray-400">Suggested Cc:</span>
              {ccSuggestions.map(s => (
                <span
                  key={s.email}
                  className="flex items-center gap-1 text-[11px] bg-accent/10 text-accent border border-accent/20 rounded-full pl-2 pr-1 py-0.5"
                >
                  <button onClick={() => addCc(s.email)} title={`Add ${s.email} to Cc`} className="hover:underline">
                    {s.name || s.email}
                  </button>
                  <button
                    onClick={() => setCcSuggestions(prev => prev.filter(x => x.email !== s.email))}
                    title="Dismiss"
                    className="text-accent/50 hover:text-red-500 font-bold px-0.5"
                  >✕</button>
                </span>
              ))}
            </div>
          )}

          {showCc && (
            <div className="flex items-center px-5 py-2.5 gap-3">
              <span className="text-xs text-gray-400 w-10">Cc</span>
              <input
                type="text"
                value={cc}
                onChange={e => setCc(e.target.value)}
                placeholder="cc@example.com"
                className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"
              />
            </div>
          )}

          <div className="flex items-center px-5 py-2.5 gap-3">
            <span className="text-xs text-gray-400 w-10">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"
            />
          </div>

          {accounts.length > 1 && (
            <div className="flex items-center px-5 py-2.5 gap-3">
              <span className="text-xs text-gray-400 w-10">From</span>
              <select
                value={accountId}
                onChange={e => setAccountId(Number(e.target.value))}
                className="text-sm text-gray-800 outline-none bg-transparent"
              >
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.username}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Rich text toolbar */}
        <div className="flex gap-0.5 px-5 pt-3 pb-1 flex-wrap">
          {[
            { cmd: 'bold', icon: 'B', cls: 'font-bold' },
            { cmd: 'italic', icon: 'I', cls: 'italic' },
            { cmd: 'underline', icon: 'U', cls: 'underline' },
          ].map(({ cmd, icon, cls }) => (
            <button key={cmd} type="button"
              onMouseDown={e => { e.preventDefault(); document.execCommand(cmd, false) }}
              className={`text-xs px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600 ${cls}`}
              title={cmd.charAt(0).toUpperCase() + cmd.slice(1)}>
              {icon}
            </button>
          ))}
          <div className="w-px bg-gray-200 mx-0.5 self-stretch" />
          <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('insertUnorderedList', false) }}
            className="text-xs px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600" title="Bullet list">≡</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('insertOrderedList', false) }}
            className="text-xs px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600" title="Numbered list">1.</button>
          <div className="w-px bg-gray-200 mx-0.5 self-stretch" />
          <button type="button"
            onMouseDown={e => {
              e.preventDefault()
              const url = prompt('Enter URL:')
              if (url) document.execCommand('createLink', false, url)
            }}
            className="text-xs px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600" title="Insert link">🔗</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('removeFormat', false) }}
            className="text-xs px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600" title="Clear formatting">✕</button>
        </div>

        {/* Body */}
        <div
          ref={contentRef}
          contentEditable
          suppressContentEditableWarning
          onInput={() => { if (contentRef.current) setBody(contentRef.current.innerHTML) }}
          className="flex-1 min-h-[220px] px-5 py-3 text-sm text-gray-800 outline-none overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-gray-300"
          style={{ fontFamily: BODY_FONT, lineHeight: 1.6 }}
          data-placeholder="Write your message…"
        />

        {/* AI rewrite toolbar */}
        <div className="px-5 pb-2 space-y-1.5 border-t border-gray-100 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleDraftFromIdea}
              disabled={draftingFromIdea || adjustingTone || !body.trim()}
              title="Type rough notes or bullet points — AI turns them into a complete email"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-40 transition-colors font-medium"
            >
              {draftingFromIdea ? <><span className="animate-spin inline-block text-[10px]">⟳</span> Drafting…</> : '✦ Draft Email'}
            </button>
            <span className="text-[10px] text-gray-300 self-center">·</span>
            <button
              onClick={() => handleAdjustTone('improve')}
              disabled={adjustingTone || draftingFromIdea || !body.trim()}
              title="AI rewrites your draft — keeps your intent, fixes grammar and clarity"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors font-medium"
            >
              {adjustingTone ? <><span className="animate-spin inline-block text-[10px]">⟳</span> Improving…</> : '✦ Improve'}
            </button>
            <span className="text-[10px] text-gray-400 self-center">tone:</span>
            {AI_TONES.map(t => (
              <button key={t} onClick={() => handleAdjustTone(t)} disabled={adjustingTone || draftingFromIdea || !body.trim()}
                className="text-[10px] px-2 py-0.5 border border-gray-200 rounded-full hover:bg-gray-100 disabled:opacity-40 capitalize text-gray-600">
                {t}
              </button>
            ))}
            {(adjustingTone || draftingFromIdea) && <span className="text-[10px] text-gray-400 animate-pulse">rewriting…</span>}
          </div>
        </div>

        <ToneCoach text={body} onRewrite={result => setBodyContent(DOMPurify.sanitize(plainTextToHtml(result), { USE_PROFILES: { html: true } }))} />

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
          {msg ? (
            <span className={`text-xs ${msg === 'Sent!' ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>
          ) : <span />}
          <div className="flex items-center gap-2">
            <VoiceDictation
              onTranscript={text => {
                if (contentRef.current) {
                  contentRef.current.innerHTML = (contentRef.current.innerHTML + ' ' + text).trim()
                  setBody(contentRef.current.innerHTML)
                }
              }}
            />
            <button
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg"
            >
              Discard
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !to.trim()}
              className="flex items-center gap-1.5 bg-accent text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
