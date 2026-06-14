import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { EmailProvider, Account, IngestProgress } from '../types'
import { ConfigPanel } from './ConfigPanel'
import { FolderPicker } from './FolderPicker'
import { WebhooksSettings } from './WebhooksSettings'
import { NotifySettings } from './NotifySettings'
import { TasksExportSettings } from './TasksExportSettings'
import { ReportScheduleSettings } from './ReportScheduleSettings'
import { BackupSettings } from './BackupSettings'
import { OvernightTriageSettings } from './OvernightTriageSettings'
import { EmailRulesPanel } from './EmailRulesPanel'
import { AddAccountForm } from './AddAccountForm'

type Section = 'accounts' | 'documents' | 'app' | 'rules' | 'integrations' | 'data'

const NAV: { id: Section; icon: string; label: string }[] = [
  { id: 'accounts',     icon: '📧', label: 'Accounts' },
  { id: 'documents',    icon: '📁', label: 'Documents' },
  { id: 'app',          icon: '⚙️',  label: 'App Settings' },
  { id: 'rules',        icon: '🛡️',  label: 'Rules & Filters' },
  { id: 'integrations', icon: '🔗', label: 'Integrations' },
  { id: 'data',         icon: '🔧', label: 'Data & Backup' },
]

const PROVIDER_COLORS: Record<EmailProvider, string> = {
  yahoo_imap:   'bg-purple-100 text-purple-700',
  gmail:        'bg-red-100 text-red-700',
  hotmail:      'bg-blue-100 text-blue-700',
  generic_imap: 'bg-gray-100 text-gray-700',
  office365:    'bg-teal-100 text-teal-700',
}
const PROVIDER_NAMES: Record<EmailProvider, string> = {
  yahoo_imap: 'Yahoo', gmail: 'Gmail', hotmail: 'Hotmail', generic_imap: 'IMAP', office365: 'Office 365',
}

interface Props {
  onConnected: () => void
  initialTab?: 'accounts' | 'config' | 'integrations'
}

export function Settings({ onConnected, initialTab }: Props) {
  const initSection: Section = initialTab === 'config' ? 'app' : initialTab === 'integrations' ? 'integrations' : 'accounts'
  const [section, setSection] = useState<Section>(initSection)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [ingestingId, setIngestingId] = useState<number | 'all' | null>(null)
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [docFolders, setDocFolders] = useState<string[]>([])
  const [docIngesting, setDocIngesting] = useState(false)
  const [docMsg, setDocMsg] = useState('')
  const [docCount, setDocCount] = useState<number | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [emailReindexing, setEmailReindexing] = useState(false)
  const [emailReindexMsg, setEmailReindexMsg] = useState('')
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearMsg, setClearMsg] = useState('')
  const [clearFromDate, setClearFromDate] = useState('')
  const [updateStatus, setUpdateStatus] = useState<{ checking?: boolean; msg?: string; available?: boolean; latest?: string }>({})

  const loadAccounts = async () => {
    try { setAccounts(await api.getAccounts()) } catch { setAccounts([]) }
  }

  useEffect(() => {
    loadAccounts()
    api.getDocumentFolders().then(r => setDocFolders(r.folders || [])).catch(() => {})
    api.listDocuments().then(r => setDocCount(r.total)).catch(() => {})
  }, [])

  const handleIngest = async (id: number | 'all') => {
    setIngestingId(id)
    setProgress({ total: 0, processed: 0, status: 'running', message: 'Starting…' })
    try {
      if (id === 'all') await api.ingestAll(fromDate || undefined)
      else await api.ingestAccount(id, fromDate || undefined)
      const es = api.subscribeAccountsIngestProgress(p => {
        setProgress(p)
        if (p.status === 'completed' || p.status === 'error') {
          es.close(); setIngestingId(null)
          if (p.status === 'completed') onConnected()
        }
      })
    } catch { setIngestingId(null) }
  }

  const handleRemove = async (id: number) => { await api.removeAccount(id); await loadAccounts() }

  const handleConsolidate = async () => {
    try { const r = await api.consolidateAccounts(); await loadAccounts(); if (r.accounts_removed > 0) onConnected(); alert(r.message) } catch { }
  }

  return (
    <div className="min-h-screen bg-gray-50/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 w-full max-w-3xl flex overflow-hidden" style={{ maxHeight: '92vh' }}>

        {/* Sidebar */}
        <div className="w-48 flex-shrink-0 bg-gray-50 border-r border-gray-100 flex flex-col">
          <div className="px-5 py-5 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-900">Director Assistant</p>
            <p className="text-xs text-gray-400 mt-0.5">Settings</p>
          </div>
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            {NAV.map(n => (
              <button key={n.id} onClick={() => setSection(n.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  section === n.id ? 'bg-accent text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}>
                <span className="text-base leading-none">{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>
          <div className="p-3 border-t border-gray-100">
            <button onClick={onConnected}
              className="w-full text-xs text-gray-400 hover:text-accent py-2 rounded-lg hover:bg-gray-100 transition-colors font-medium">
              ← Open app
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 min-w-0">

          {/* ── Accounts ── */}
          {section === 'accounts' && (
            <div className="space-y-5">
              <SectionHeader title="Email Accounts" desc="Connected email providers that are polled for new messages." />

              {accounts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Connected</p>
                    {accounts.length > 1 && accounts.map(a => a.username).some((u, i, arr) => arr.indexOf(u) !== i) && (
                      <button onClick={handleConsolidate} className="text-xs text-amber-600 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg px-2.5 py-1 transition-colors">⚡ Merge duplicates</button>
                    )}
                  </div>
                  {accounts.map(acc => (
                    <div key={acc.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{acc.username}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PROVIDER_COLORS[acc.provider]}`}>{PROVIDER_NAMES[acc.provider]}</span>
                          {acc.last_ingested && <span className="text-xs text-gray-400">Last import {new Date(acc.last_ingested).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <button onClick={() => handleIngest(acc.id)} disabled={ingestingId !== null} className="text-xs text-accent hover:underline disabled:opacity-50 font-medium">
                        {ingestingId === acc.id ? 'Importing…' : 'Import'}
                      </button>
                      <button onClick={() => handleRemove(acc.id)} className="text-xs text-gray-400 hover:text-red-500">Remove</button>
                    </div>
                  ))}

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 whitespace-nowrap">From date</label>
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                    {fromDate && <button onClick={() => setFromDate('')} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>}
                  </div>

                  <button onClick={() => handleIngest('all')} disabled={ingestingId !== null}
                    className="w-full bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {ingestingId === 'all' ? 'Importing all…' : 'Import all emails'}
                  </button>

                  {progress && (
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span className="truncate pr-2">{progress.message}</span>
                        {progress.total > 0 && <span className="flex-shrink-0">{progress.processed}/{progress.total}</span>}
                      </div>
                      {progress.total > 0 && (
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.round(progress.processed / progress.total * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!showAdd ? (
                <button onClick={() => setShowAdd(true)}
                  className="w-full text-sm text-gray-500 hover:text-accent border border-dashed border-gray-300 hover:border-accent rounded-xl py-3 transition-colors">
                  + Add email account
                </button>
              ) : (
                <div className="border border-gray-200 rounded-xl p-5">
                  <p className="text-sm font-semibold text-gray-700 mb-4">Add account</p>
                  <AddAccountForm onConnected={onConnected} onCancel={() => setShowAdd(false)} onAccountAdded={loadAccounts} />
                </div>
              )}
            </div>
          )}

          {/* ── Documents ── */}
          {section === 'documents' && (
            <div className="space-y-4">
              <SectionHeader title="Documents" desc="Index local folders — PDFs, Word, Excel, and text files are searchable alongside emails." />
              {docCount !== null && docCount > 0 && <p className="text-xs text-gray-400">{docCount} file{docCount !== 1 ? 's' : ''} currently indexed</p>}

              {docFolders.length > 0 && (
                <div className="space-y-1.5">
                  {docFolders.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="flex-1 text-xs text-gray-700 truncate font-mono">{f}</span>
                      <button onClick={async () => { const next = docFolders.filter((_, j) => j !== i); await api.setDocumentFolders(next).catch(() => {}); setDocFolders(next) }}
                        className="text-xs text-gray-400 hover:text-red-500">Remove</button>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setShowFolderPicker(true)}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-amber-300 text-amber-600 hover:bg-amber-50 rounded-xl py-3 text-sm transition-colors">
                📂 Browse &amp; add folder…
              </button>

              <div className="flex gap-2">
                <button onClick={async () => {
                    setDocIngesting(true); setDocMsg('')
                    try {
                      await api.ingestDocuments()
                      let w = 0
                      const id = setInterval(async () => {
                        w += 1500; const s = await api.getDocumentIngestStatus().catch(() => null)
                        if (!s || s.status !== 'running') { clearInterval(id); setDocMsg(s?.message || 'Done'); api.listDocuments().then(r => setDocCount(r.total)).catch(() => {}); setDocIngesting(false) }
                        else setDocMsg(s.message)
                        if (w > 120000) { clearInterval(id); setDocIngesting(false) }
                      }, 1500)
                    } catch (e: unknown) { setDocMsg(e instanceof Error ? e.message : 'Failed'); setDocIngesting(false) }
                  }} disabled={docIngesting || docFolders.length === 0}
                  className="flex-1 bg-amber-500 text-white text-sm font-medium py-2 rounded-lg hover:bg-amber-600 disabled:opacity-50">
                  {docIngesting ? 'Indexing…' : 'Index Documents'}
                </button>
                <button onClick={async () => {
                    setEmailReindexing(true); setEmailReindexMsg('')
                    try {
                      await api.reindexEmails()
                      let w = 0
                      const id = setInterval(async () => {
                        w += 2000; const s = await api.getReindexEmailsStatus().catch(() => null)
                        if (!s || s.status !== 'running') { clearInterval(id); setEmailReindexMsg(s?.status === 'done' ? `Done — ${s.indexed} re-indexed` : s?.error || 'Done'); setEmailReindexing(false) }
                        if (w > 300000) { clearInterval(id); setEmailReindexing(false) }
                      }, 2000)
                    } catch (e: unknown) { setEmailReindexMsg(e instanceof Error ? e.message : 'Failed'); setEmailReindexing(false) }
                  }} disabled={emailReindexing}
                  className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  {emailReindexing ? 'Rebuilding…' : 'Rebuild Email Index'}
                </button>
              </div>
              {(docMsg || emailReindexMsg) && (
                <p className="text-xs text-gray-500">{docMsg || emailReindexMsg}</p>
              )}
            </div>
          )}

          {/* ── App Settings ── */}
          {section === 'app' && (
            <div className="space-y-5">
              <SectionHeader title="App Settings" desc="AI providers, polling, display preferences, and smart triage rules." />
              <ConfigPanel />
              <TriageRulesPanel />
            </div>
          )}

          {/* ── Rules & Filters ── */}
          {section === 'rules' && (
            <div className="space-y-5">
              <SectionHeader title="Rules & Filters" desc="Automatically label, archive, or delete emails based on sender, subject, or content." />
              <EmailRulesPanel />
            </div>
          )}

          {/* ── Integrations ── */}
          {section === 'integrations' && (
            <div className="space-y-6">
              <SectionHeader title="Integrations" desc="Connect external services for notifications, task sync, and automated reports." />
              {[
                ['Slack & Teams Notifications', <NotifySettings />],
                ['Webhooks / Zapier', <WebhooksSettings />],
                ['Task Export (Todoist / Jira)', <TasksExportSettings />],
                ['Overnight Triage Agent', <OvernightTriageSettings />],
                ['Scheduled Report Email', <ReportScheduleSettings />],
              ].map(([title, comp]) => (
                <section key={title as string}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title as string}</p>
                  {comp}
                </section>
              ))}
            </div>
          )}

          {/* ── Data & Backup ── */}
          {section === 'data' && (
            <div className="space-y-6">
              <SectionHeader title="Data & Backup" desc="Backup your database, check for updates, and manage the data lifecycle." />

              <section>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Backup</p>
                <BackupSettings />
              </section>

              <section>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Updates</p>
                <button onClick={async () => {
                    setUpdateStatus({ checking: true, msg: 'Checking…' })
                    try {
                      const r = await api.checkUpdate()
                      if (r.error) setUpdateStatus({ msg: `Check failed: ${r.error}` })
                      else if (r.update_available && r.latest) setUpdateStatus({ available: true, latest: r.latest, msg: `Update available: v${r.latest}` })
                      else setUpdateStatus({ msg: `Up to date (v${r.current})` })
                    } catch { setUpdateStatus({ msg: 'Check failed — no network?' }) }
                  }} disabled={updateStatus.checking}
                  className="w-full border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                  {updateStatus.checking ? 'Checking…' : 'Check for Updates'}
                </button>
                {updateStatus.msg && <p className={`text-xs mt-1.5 ${updateStatus.available ? 'text-blue-600' : 'text-gray-500'}`}>{updateStatus.msg}</p>}
                {updateStatus.available && (
                  <button onClick={async () => {
                      setUpdateStatus(s => ({ ...s, msg: 'Installing…', checking: true }))
                      try { const r = await api.applyUpdate(); setUpdateStatus({ msg: r.message }); setTimeout(() => window.location.reload(), 30000) }
                      catch { setUpdateStatus({ msg: 'Update failed.' }) }
                    }} className="w-full mt-2 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 transition-colors">
                    Install v{updateStatus.latest}
                  </button>
                )}
              </section>

              <section className="border-t border-red-100 pt-5">
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">Danger Zone</p>
                {!clearConfirm ? (
                  <button onClick={() => { setClearConfirm(true); setClearFromDate('') }} disabled={clearing}
                    className="w-full border border-red-200 text-red-500 text-sm font-medium py-2 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                    Clear Database &amp; Re-ingest
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      This deletes <strong>all cached emails and vectors</strong> then re-imports. Cannot be undone.
                    </p>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Import from date (blank = all)</label>
                      <input type="date" value={clearFromDate} onChange={e => setClearFromDate(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async () => {
                          setClearing(true); setClearMsg(''); setClearConfirm(false)
                          try {
                            const res = await api.clearAndReingest(clearFromDate || undefined)
                            setClearMsg(`Cleared ${res.cleared} emails. Re-importing from ${res.accounts} account${res.accounts !== 1 ? 's' : ''}…`)
                            const es = api.subscribeAccountsIngestProgress(p => {
                              if (p.status === 'completed' || p.status === 'error') { es.close(); setClearing(false); setClearMsg(p.message); onConnected() }
                            })
                          } catch (e: unknown) { setClearMsg(e instanceof Error ? e.message : 'Failed'); setClearing(false) }
                        }} disabled={clearing}
                        className="flex-1 bg-red-500 text-white text-sm font-medium py-2 rounded-lg hover:bg-red-600 disabled:opacity-50">
                        {clearing ? 'Clearing…' : 'Yes, clear everything'}
                      </button>
                      <button onClick={() => setClearConfirm(false)} className="px-4 py-2 border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                )}
                {clearMsg && <p className="text-xs mt-2 text-gray-600">{clearMsg}</p>}
              </section>
            </div>
          )}

        </div>
      </div>

      {showFolderPicker && (
        <FolderPicker
          onSelect={async path => {
            if (docFolders.includes(path)) return
            const next = [...docFolders, path]
            await api.setDocumentFolders(next).catch(() => {})
            setDocFolders(next)
          }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  )
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border-b border-gray-100 pb-4">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
    </div>
  )
}

function TriageRulesPanel() {
  const [rules, setRules] = useState<{ id: number; rule: string }[]>([])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.getTriageRules().then(setRules).catch(() => {}) }, [])

  const add = async () => {
    if (!input.trim() || saving) return
    setSaving(true)
    try { const r = await api.addTriageRule(input.trim()); setRules(prev => [...prev, r]); setInput('') }
    finally { setSaving(false) }
  }

  const remove = async (id: number) => { await api.deleteTriageRule(id).catch(() => {}); setRules(prev => prev.filter(r => r.id !== id)) }

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-gray-700 mb-1">Smart Triage Rules</p>
      <p className="text-xs text-gray-400 mb-3">Plain-English rules: "from: ceo@corp.com → critical" · "invoice in subject → urgent"</p>
      <div className="flex gap-2 mb-3">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="from: board@company.com → critical"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
        <button onClick={add} disabled={saving || !input.trim()} className="text-sm bg-accent text-white rounded-lg px-4 py-2 disabled:opacity-50">Add</button>
      </div>
      {rules.length === 0 && <p className="text-xs text-gray-300 italic">No rules yet.</p>}
      <ul className="space-y-1">
        {rules.map(r => (
          <li key={r.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-gray-700 font-mono">{r.rule}</span>
            <button onClick={() => remove(r.id)} className="text-gray-300 hover:text-red-400 ml-3">✕</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
