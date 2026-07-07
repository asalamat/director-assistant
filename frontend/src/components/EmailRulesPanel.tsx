import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { CATEGORY_LABELS } from '../types'
import type { EmailCategory } from '../types'

const FIELDS = ['sender', 'subject', 'body'] as const
const CONDITIONS = ['contains', 'equals', 'starts_with', 'ends_with'] as const
const ACTIONS = ['label', 'archive', 'mark_read', 'delete'] as const
const CATEGORIES = Object.keys(CATEGORY_LABELS) as EmailCategory[]

type LastRun = { ran_at: string; labeled: number; archived: number; marked: number; deleted: number }

function timeAgo(iso: string): string {
  const then = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z').getTime()
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

type ProposedRule = { name: string; field: string; condition: string; value: string; action: string; label: string; priority: number }

export function EmailRulesPanel() {
  const [rules, setRules] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', field: 'sender', condition: 'contains', value: '', action: 'label', label: 'proposal', priority: 0 })
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<{ count: number; sample: { id: number; subject: string; sender: string }[] } | null>(null)
  const [lastRun, setLastRun] = useState<LastRun | null>(null)
  const [nlInput, setNlInput] = useState('')
  const [nlGenerating, setNlGenerating] = useState(false)
  const [proposals, setProposals] = useState<ProposedRule[]>([])
  const [savingProposal, setSavingProposal] = useState<number | null>(null)

  const loadLastRun = () => api.getEmailRulesLastRun().then(setLastRun).catch(() => {})
  const load = () => api.getEmailRules().then(r => setRules(r.rules)).catch(() => {})
  useEffect(() => { load(); loadLastRun() }, [])

  const doPreview = async () => {
    if (!form.value.trim()) return
    setPreviewing(true)
    setPreview(null)
    try {
      const r = await api.previewEmailRule({ field: form.field, condition: form.condition, value: form.value })
      setPreview(r)
    } catch (e: any) { setMsg(`Error: ${e.message}`) }
    setPreviewing(false)
  }

  const save = async () => {
    if (!form.name.trim() || !form.value.trim()) return
    setSaving(true)
    try {
      await api.createEmailRule(form)
      setShowForm(false)
      setForm({ name: '', field: 'sender', condition: 'contains', value: '', action: 'label', label: 'proposal', priority: 0 })
      setPreview(null)
      load()
      setMsg('Rule created')
      setTimeout(() => setMsg(''), 3000)
    } catch (e: any) { setMsg(`Error: ${e.message}`) }
    setSaving(false)
  }

  const runAll = async () => {
    setRunning(true)
    try {
      const r = await api.runEmailRules()
      setMsg(`Done — deleted: ${r.deleted}, labeled: ${r.labeled}, archived: ${r.archived}, marked read: ${r.marked}`)
      setTimeout(() => setMsg(''), 6000)
      load()
      loadLastRun()
    } catch (e: any) { setMsg(`Error: ${e.message}`) }
    setRunning(false)
  }

  const del = async (id: number) => {
    await api.deleteEmailRule(id)
    setRules(prev => prev.filter(r => r.id !== id))
  }

  const generateFromNL = async () => {
    if (!nlInput.trim()) return
    setNlGenerating(true)
    setProposals([])
    try {
      const r = await api.rulesFromNL(nlInput.trim())
      setProposals(r.rules)
      if (r.rules.length === 0) setMsg('No rules could be generated — try rephrasing.')
    } catch (e: any) { setMsg(`Error: ${e.message}`) }
    setNlGenerating(false)
  }

  const saveProposal = async (p: ProposedRule, idx: number) => {
    setSavingProposal(idx)
    try {
      await api.createEmailRule(p)
      setProposals(prev => prev.filter((_, i) => i !== idx))
      load()
      setMsg('Rule saved')
      setTimeout(() => setMsg(''), 3000)
    } catch (e: any) { setMsg(`Error: ${e.message}`) }
    setSavingProposal(null)
  }

  const toggle = async (id: number) => {
    await api.toggleEmailRule(id)
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: r.enabled ? 0 : 1 } : r))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Email Rules</p>
          <p className="text-xs text-gray-400">Auto-label, archive, mark read, or delete based on sender/subject/body</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={runAll}
            disabled={running}
            title="Apply all enabled rules to your existing inbox now"
            className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {running ? '⟳ Running…' : '▶ Run Now'}
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + New Rule
          </button>
        </div>
      </div>

      {/* Natural language rule builder */}
      <div className="border border-dashed border-accent/40 rounded-xl p-3 bg-accent/5 space-y-2">
        <p className="text-xs font-medium text-accent">✨ Describe a rule in plain English</p>
        <div className="flex gap-2">
          <input
            value={nlInput}
            onChange={e => setNlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generateFromNL()}
            placeholder="e.g. Move LinkedIn notifications to archive, flag emails from my board as urgent"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
          />
          <button
            onClick={generateFromNL}
            disabled={nlGenerating || !nlInput.trim()}
            className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {nlGenerating ? '⟳ Generating…' : 'Generate'}
          </button>
        </div>
        {proposals.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-gray-500">{proposals.length} rule{proposals.length !== 1 ? 's' : ''} proposed — review and save:</p>
            {proposals.map((p, i) => (
              <div key={i} className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{p.name}</p>
                  <p className="text-xs text-gray-400">
                    When <span className="text-gray-600 dark:text-gray-300">{p.field}</span> {p.condition.replace('_', ' ')} &ldquo;<span className="text-gray-600 dark:text-gray-300">{p.value}</span>&rdquo;
                    {' → '}<span className={p.action === 'delete' ? 'text-red-500 font-medium' : 'text-accent font-medium'}>{p.action.replace('_', ' ')}{p.label ? ` as ${p.label}` : ''}</span>
                  </p>
                </div>
                <button
                  onClick={() => saveProposal(p, i)}
                  disabled={savingProposal === i}
                  className="text-xs bg-green-600 text-white px-2.5 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {savingProposal === i ? '…' : 'Save'}
                </button>
                <button
                  onClick={() => setProposals(prev => prev.filter((_, j) => j !== i))}
                  className="text-gray-300 hover:text-red-400 text-xs"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {msg && (
        <p className={`text-xs ${msg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{msg}</p>
      )}

      {lastRun && (
        <p className="text-xs text-gray-400">
          Last run: {timeAgo(lastRun.ran_at)} — labeled {lastRun.labeled}, archived {lastRun.archived}, marked read {lastRun.marked}, deleted {lastRun.deleted}
        </p>
      )}

      {showForm && (
        <div className="border border-gray-200 rounded-xl p-4 space-y-2 bg-gray-50">
          <input
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="Rule name"
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
          />
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs text-gray-500 self-center">When</span>
            <select
              value={form.field}
              onChange={e => { setForm(p => ({ ...p, field: e.target.value })); setPreview(null) }}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none"
            >
              {FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <select
              value={form.condition}
              onChange={e => { setForm(p => ({ ...p, condition: e.target.value })); setPreview(null) }}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none"
            >
              {CONDITIONS.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
            <input
              value={form.value}
              onChange={e => { setForm(p => ({ ...p, value: e.target.value })); setPreview(null) }}
              placeholder="value…"
              className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs text-gray-500 self-center">Then</span>
            <select
              value={form.action}
              onChange={e => setForm(p => ({ ...p, action: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none"
            >
              {ACTIONS.map(a => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
            </select>
            {form.action === 'label' && (
              <select
                value={form.label}
                onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c].text}</option>)}
              </select>
            )}
          </div>
          {preview && (
            <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-2.5 text-xs">
              <p className="font-medium text-blue-800">
                Would affect {preview.count} email{preview.count === 1 ? '' : 's'}
              </p>
              {preview.sample.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-blue-700/80">
                  {preview.sample.slice(0, 3).map(s => (
                    <li key={s.id} className="truncate">• {s.subject}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setPreview(null) }} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
            <button
              onClick={doPreview}
              disabled={previewing || !form.value.trim()}
              title="Count how many emails this rule would affect, without changing anything"
              className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {previewing ? 'Checking…' : 'Preview'}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Rule'}
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 && !showForm && (
        <p className="text-xs text-gray-400 text-center py-4">No rules yet. Create one to auto-organize incoming emails.</p>
      )}

      {rules.map(r => (
        <div key={r.id} className={`border rounded-xl p-3 flex items-center gap-2 ${r.enabled ? (r.action === 'delete' ? 'border-red-200 bg-red-50/30' : 'border-gray-200') : 'border-gray-100 opacity-60'}`}>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{r.name}</p>
            <p className="text-xs text-gray-400">
              When {r.field} {r.condition.replace('_', ' ')} &ldquo;{r.value}&rdquo; &rarr;{' '}
              <span className={r.action === 'delete' ? 'text-red-600 font-medium' : ''}>
                {r.action.replace('_', ' ')}{r.label ? ` as ${r.label}` : ''}
              </span>
            </p>
          </div>
          <button
            onClick={() => toggle(r.id)}
            className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
          >
            {r.enabled ? 'On' : 'Off'}
          </button>
          <button onClick={() => del(r.id)} className="text-gray-300 hover:text-red-400 text-xs">x</button>
        </div>
      ))}
    </div>
  )
}
