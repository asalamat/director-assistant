import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { Account } from '../types'
import { useEmailContext } from '../contexts/EmailContext'
import { ToneCoach } from './ToneCoach'
import { VoiceDictation } from './VoiceDictation'

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
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')
  const toRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTo(initialTo)
      setSubject(initialSubject)
      setCc('')
      setBody(initialBody)
      setMsg('')
      setSending(false)
      setTimeout(() => toRef.current?.focus(), 50)
    }
  }, [open, initialTo, initialSubject, initialBody])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleSend = async () => {
    if (!to.trim() || !subject.trim()) {
      setMsg('To and Subject are required.')
      return
    }
    setSending(true)
    setMsg('')
    try {
      await api.sendNew({ to, cc: cc || undefined, subject, body, account_id: accountId })
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

        {/* Body */}
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write your message…"
          rows={10}
          className="flex-1 px-5 py-4 text-sm text-gray-800 resize-none outline-none placeholder-gray-300"
        />

        <ToneCoach text={body} onRewrite={setBody} />

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
          {msg ? (
            <span className={`text-xs ${msg === 'Sent!' ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>
          ) : <span />}
          <div className="flex items-center gap-2">
            <VoiceDictation
              onTranscript={text => setBody(b => (b.trim() ? `${b.replace(/\s+$/, '')} ${text}` : text))}
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
