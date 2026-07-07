import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { CRMDeal, CRMDealEmail } from '../types'

const STAGES = ['prospect', 'active', 'negotiating', 'won', 'lost']
const STAGE_LABEL: Record<string, string> = {
  prospect: 'Prospect', active: 'Active', negotiating: 'Negotiating', won: 'Won', lost: 'Lost',
}

interface Props {
  deal: CRMDeal
  onClose: () => void
  onChanged: () => void
  onDraft?: (draft: { to: string; subject: string; body: string }) => void
}

export function CRMDealDetail({ deal, onClose, onChanged, onDraft }: Props) {
  const [tab, setTab] = useState<'overview' | 'emails'>('overview')
  const [stage, setStage] = useState(deal.stage)
  const [notes, setNotes] = useState(deal.notes || '')
  const [value, setValue] = useState(deal.value || '')
  const [saving, setSaving] = useState(false)
  const [emails, setEmails] = useState<CRMDealEmail[]>([])
  const [emailsLoading, setEmailsLoading] = useState(false)
  const [linkId, setLinkId] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setStage(deal.stage); setNotes(deal.notes || ''); setValue(deal.value || '')
  }, [deal])

  const loadEmails = useCallback(() => {
    setEmailsLoading(true)
    api.getCRMDealEmails(deal.id)
      .then(r => setEmails(r.emails))
      .catch(() => setEmails([]))
      .finally(() => setEmailsLoading(false))
  }, [deal.id])

  useEffect(() => { if (tab === 'emails') loadEmails() }, [tab, loadEmails])

  const save = async (patch: Partial<{ stage: string; notes: string; value: string }>) => {
    setSaving(true)
    try {
      await api.updateCRMDeal(deal.id, patch)
      onChanged()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const changeStage = (s: string) => { setStage(s); save({ stage: s }) }

  const linkEmail = async () => {
    if (!linkId.trim()) return
    try {
      await api.linkEmailToDeal(deal.id, linkId.trim(), 'inbound')
      setLinkId('')
      loadEmails()
    } catch (e) { setMsg((e as Error).message) }
  }

  const unlink = async (emailId: string) => {
    await api.unlinkDealEmail(deal.id, emailId).catch(() => {})
    setEmails(prev => prev.filter(e => e.email_id !== emailId))
  }

  const draftFollowup = async () => {
    setDrafting(true); setMsg('')
    try {
      const d = await api.draftCRMFollowup(deal.id)
      if (onDraft) onDraft(d)
      else setMsg('Draft ready')
    } catch (e) { setMsg((e as Error).message) } finally { setDrafting(false) }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div className="relative w-full max-w-md h-full bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900 truncate">{deal.name}</h2>
            {deal.contact_email && <p className="text-xs text-gray-400 truncate">{deal.contact_email}</p>}
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 border-b border-gray-100">
          {(['overview', 'emails'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px capitalize transition-colors ${
                tab === t ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'overview' ? (
            <>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-gray-400">Stage</label>
                <select value={stage} onChange={e => changeStage(e.target.value)}
                  className="w-full mt-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent">
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-gray-400">Value</label>
                <input value={value} onChange={e => setValue(e.target.value)} onBlur={() => save({ value })}
                  placeholder="e.g. $50k"
                  className="w-full mt-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-gray-400">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => save({ notes })} rows={5}
                  className="w-full mt-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-accent" />
              </div>
              {saving && <p className="text-[11px] text-gray-300">Saving…</p>}
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input value={linkId} onChange={e => setLinkId(e.target.value)} placeholder="Email ID to link"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent" />
                <button onClick={linkEmail} disabled={!linkId.trim()}
                  className="text-xs bg-gray-100 text-gray-600 rounded-lg px-3 hover:bg-gray-200 disabled:opacity-50">Link Email</button>
              </div>
              {emailsLoading ? (
                <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
              ) : emails.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No emails linked yet. Link an email by ID above.</p>
              ) : emails.map(e => (
                <div key={e.email_id} className="border border-gray-200 rounded-lg p-2.5 flex gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{e.subject || '(no subject)'}</p>
                    <p className="text-[11px] text-gray-400 truncate">{e.sender} · {e.date?.slice(0, 10)}</p>
                    <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded ${e.direction === 'outbound' ? 'bg-blue-50 text-accent' : 'bg-gray-100 text-gray-500'}`}>{e.direction}</span>
                  </div>
                  <button onClick={() => unlink(e.email_id)} className="text-gray-300 hover:text-red-500 text-xs flex-shrink-0">✕</button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2">
          {msg && <span className="text-[11px] text-gray-400">{msg}</span>}
          <button onClick={draftFollowup} disabled={drafting}
            className="ml-auto text-xs bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-50 transition">
            {drafting ? 'Drafting…' : '✉️ Draft Follow-Up'}
          </button>
        </div>
      </div>
    </div>
  )
}
