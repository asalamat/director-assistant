import { useState, useEffect, useRef } from 'react'
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
  const [ragStats, setRagStats] = useState<{ count: number; collection_size_mb: number; last_indexed: string; embedding_model: string; status: string } | null>(null)

  const loadAccounts = async () => {
    try { setAccounts(await api.getAccounts()) } catch { setAccounts([]) }
  }

  useEffect(() => {
    loadAccounts()
    api.getDocumentFolders().then(r => setDocFolders(r.folders || [])).catch(() => {})
    api.listDocuments().then(r => setDocCount(r.total)).catch(() => {})
  }, [])

  useEffect(() => {
    if (section === 'data') {
      api.getRagStats().then(setRagStats).catch(() => {})
    }
  }, [section])

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
        <div className="flex-1 overflow-y-auto p-6 min-w-0 min-h-0">

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
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
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
              <section>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">LinkedIn</p>
                <LinkedInSettingsPanel />
              </section>
              <section>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Instagram</p>
                <InstagramSettingsPanel />
              </section>
            </div>
          )}

          {/* ── Data & Backup ── */}
          {section === 'data' && (
            <div className="space-y-6">
              <SectionHeader title="Data & Backup" desc="Backup your database, check for updates, and manage the data lifecycle." />

              <section>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">RAG Index</p>
                {ragStats ? (
                  <div className="border border-gray-200 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Status</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        ragStats.status === 'ready' ? 'bg-green-100 text-green-700' :
                        ragStats.status === 'indexing' ? 'bg-amber-100 text-amber-700' :
                        ragStats.status === 'empty' ? 'bg-gray-100 text-gray-500' :
                        'bg-red-100 text-red-600'
                      }`}>{ragStats.status}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Documents indexed</span>
                      <span className="text-xs font-medium text-gray-800">{ragStats.count.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Index size</span>
                      <span className="text-xs font-medium text-gray-800">~{ragStats.collection_size_mb} MB</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Last indexed</span>
                      <span className="text-xs font-medium text-gray-800">{ragStats.last_indexed || 'N/A'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Model</span>
                      <span className="text-xs font-mono text-gray-600">{ragStats.embedding_model}</span>
                    </div>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-xl p-4 text-center text-xs text-gray-400">Loading index stats…</div>
                )}
              </section>

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

const IMAGE_MODELS = [
  { value: 'dall-e-3',    label: 'DALL-E 3 (default)' },
  { value: 'gpt-image-1', label: 'GPT Image 1' },
  { value: 'gpt-5.5',     label: 'GPT-5.5' },
  { value: 'dall-e-2',    label: 'DALL-E 2 (fallback)' },
]

function LinkedInSettingsPanel() {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [userId, setUserId] = useState('')
  const [customPromptsRaw, setCustomPromptsRaw] = useState('')
  const [imageModel, setImageModel] = useState('dall-e-3')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<Record<string, { ok: boolean; message: string }> | null>(null)

  useEffect(() => {
    api.getLinkedInSettings()
      .then((r: any) => {
        setClientId(r.client_id || '')
        setClientSecret(r.client_secret || '')
        setAccessToken(r.access_token || '')
        setUserId(r.user_id || '')
        setCustomPromptsRaw((r.custom_prompts || []).join('\n'))
        setImageModel(r.image_model || 'dall-e-3')
      })
      .catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const prompts = customPromptsRaw.split('\n').map(s => s.trim()).filter(Boolean)
      await api.saveLinkedInSettings({
        client_id: clientId, client_secret: clientSecret,
        access_token: accessToken, user_id: userId, custom_prompts: prompts,
        image_model: imageModel,
      } as any)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const verify = async () => {
    setVerifying(true); setVerifyResult(null); setError('')
    try {
      const r = await (api as any).verifyLinkedIn()
      setVerifyResult(r)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-4">
      <p className="text-xs text-gray-400 leading-relaxed">
        To connect LinkedIn, create an app at <span className="font-mono text-gray-600">developer.linkedin.com</span>, add the <em>Share on LinkedIn</em> and <em>OpenID Connect</em> products, then generate an access token.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Client ID</label>
          <input
            type="text" value={clientId} onChange={e => setClientId(e.target.value)}
            placeholder="86xyz..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Client Secret</label>
          <input
            type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}
            placeholder="••••••••"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-600">Access Token</label>
            <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
              Get from LinkedIn Developer portal → OAuth 2.0 tools
            </span>
          </div>
          <input
            type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)}
            placeholder="••••••••"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Your LinkedIn User ID</label>
          <input
            type="text" value={userId} onChange={e => setUserId(e.target.value)}
            placeholder="urn:li:person:XXXXXXXX"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent font-mono"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Custom Image Prompts</label>
          <p className="text-xs text-gray-400 mb-1.5">One prompt per line — these appear as quick-select options in the image generation step.</p>
          <textarea
            value={customPromptsRaw} onChange={e => setCustomPromptsRaw(e.target.value)}
            rows={4}
            placeholder={"Professional headshot on white background\nModern tech office with team"}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Image Generation Model</label>
          <p className="text-xs text-gray-400 mb-1.5">Which OpenAI model to use for generating post images. If the selected model isn't available on your key, the app tries the next one automatically.</p>
          <select
            value={imageModel}
            onChange={e => setImageModel(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent bg-white"
          >
            {IMAGE_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={save} disabled={saving}
          className="flex-1 bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save LinkedIn Settings'}
        </button>
        <button
          onClick={verify} disabled={verifying}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
        >
          {verifying ? 'Verifying…' : 'Verify'}
        </button>
      </div>

      {verifyResult && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Connectivity Check</p>
          {[
            { key: 'linkedin', label: 'LinkedIn API' },
            { key: 'openai', label: 'OpenAI (DALL-E)' },
            { key: 'ai_provider', label: 'AI Provider (Claude)' },
          ].map(({ key, label }) => {
            const r = verifyResult[key]
            if (!r) return null
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${r.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {r.ok ? '✓' : '✕'}
                </span>
                <span className="font-medium text-gray-700 w-36 flex-shrink-0">{label}</span>
                <span className={`text-xs ${r.ok ? 'text-green-600' : 'text-red-500'}`}>{r.message}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InstagramSettingsPanel() {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [igUserId, setIgUserId] = useState('')
  const [imageModel, setImageModel] = useState('dall-e-3')
  const [ftpHost, setFtpHost] = useState('')
  const [ftpUser, setFtpUser] = useState('')
  const [ftpPass, setFtpPass] = useState('')
  const [ftpPath, setFtpPath] = useState('')
  const [ftpPublicUrl, setFtpPublicUrl] = useState('')
  const [connectedUsername, setConnectedUsername] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [ftpVerifying, setFtpVerifying] = useState(false)
  const [ftpVerifyMsg, setFtpVerifyMsg] = useState<{ok: boolean; message: string} | null>(null)
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle')
  const [oauthMsg, setOauthMsg] = useState('')
  const popupRef = useRef<Window | null>(null)

  useEffect(() => {
    api.getInstagramSettings()
      .then((r: any) => {
        setAppId(r.app_id || '')
        setAppSecret(r.app_secret || '')
        setIgUserId(r.ig_user_id || '')
        setImageModel(r.image_model || 'dall-e-3')
        setFtpHost(r.ftp_host || '')
        setFtpUser(r.ftp_user || '')
        setFtpPass(r.ftp_pass || '')
        setFtpPath(r.ftp_path || '')
        setFtpPublicUrl(r.ftp_public_url || '')
        setConnectedUsername(r.username || '')
        setHasToken(!!(r.access_token))
      })
      .catch(() => {})
  }, [])

  const verifyFtp = async () => {
    setFtpVerifying(true); setFtpVerifyMsg(null)
    try {
      const r = await fetch('/api/instagram/verify-ftp', { method: 'POST' }).then(x => x.json())
      setFtpVerifyMsg({ ok: r.ok, message: r.message })
    } catch { setFtpVerifyMsg({ ok: false, message: 'Request failed' }) }
    finally { setFtpVerifying(false) }
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      await api.saveInstagramSettings({ app_id: appId, app_secret: appSecret, ig_user_id: igUserId, image_model: imageModel, ftp_host: ftpHost, ftp_user: ftpUser, ftp_pass: ftpPass, ftp_path: ftpPath, ftp_public_url: ftpPublicUrl } as any)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const connect = async () => {
    if (!appId || !appSecret) { setError('Save your App ID and App Secret first'); return }
    setOauthStatus('waiting'); setOauthMsg(''); setError('')
    try {
      const { url } = await fetch('/api/oauth/instagram/auth-url').then(r => r.json())
      const popup = window.open(url, 'igauth', 'width=600,height=700,left=200,top=80')
      popupRef.current = popup
      if (!popup) { setOauthStatus('error'); setOauthMsg('Popup blocked — allow popups and try again'); return }
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'ig-oauth-complete') {
          window.removeEventListener('message', onMsg)
          setOauthStatus('done')
          setHasToken(true)
          if (e.data.username) {
            setConnectedUsername(e.data.username)
            setOauthMsg(`Connected as @${e.data.username}`)
          } else {
            setOauthMsg('Token saved — enter your Instagram Business Account ID below to complete setup')
          }
          // reload settings to get updated ig_user_id if auto-detected
          api.getInstagramSettings().then((r: any) => { setIgUserId(r.ig_user_id || ''); setConnectedUsername(r.username || '') }).catch(() => {})
        } else if (e.data?.type === 'ig-oauth-error') {
          window.removeEventListener('message', onMsg)
          setOauthStatus('error'); setOauthMsg(e.data.message || 'Connection failed')
        }
      }
      window.addEventListener('message', onMsg)
      const t = setInterval(() => {
        if (popupRef.current?.closed) {
          clearInterval(t); window.removeEventListener('message', onMsg)
          setOauthStatus(s => s === 'waiting' ? 'idle' : s)
        }
      }, 800)
    } catch (e: unknown) { setOauthStatus('error'); setOauthMsg(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-4">
      <p className="text-xs text-gray-400 leading-relaxed">
        Requires a <strong>Facebook App</strong> with Instagram Graph API enabled and an{' '}
        <strong>Instagram Business or Creator account</strong> linked to a Facebook Page.
        Create your app at <span className="font-mono text-gray-600">developers.facebook.com</span> and add{' '}
        <span className="font-mono text-[11px]">http://localhost:8000/api/oauth/instagram/callback</span> as a Valid OAuth Redirect URI.
      </p>

      {connectedUsername && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
          <span className="text-green-600 text-sm">✓</span>
          <span className="text-sm font-medium text-green-700">Connected as @{connectedUsername}</span>
          <button onClick={() => { setConnectedUsername(''); api.saveInstagramSettings({ username: '' } as any).catch(() => {}) }}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600">Disconnect</button>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Facebook App ID</label>
          <input type="text" value={appId} onChange={e => setAppId(e.target.value)}
            placeholder="1234567890123456"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">App Secret</label>
          <input type="password" value={appSecret} onChange={e => setAppSecret(e.target.value)}
            placeholder="••••••••••••••••"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        {(hasToken && !connectedUsername) && (
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Instagram Business Account ID
              <span className="text-gray-400 font-normal ml-1">(required — auto-detect failed)</span>
            </label>
            <input type="text" value={igUserId} onChange={e => setIgUserId(e.target.value)}
              placeholder="17841400123456789"
              className="w-full text-sm border border-amber-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-amber-50" />
            <p className="text-[11px] text-gray-400 mt-1">
              Find it: Graph API Explorer → run <span className="font-mono">me/accounts</span> → click your Page → run <span className="font-mono">{"?fields=instagram_business_account"}</span> → copy the <span className="font-mono">id</span>
            </p>
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Image Model</label>
          <select value={imageModel} onChange={e => setImageModel(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent bg-white">
            {IMAGE_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">DALL-E 3 / DALL-E 2 return a public URL directly. GPT Image 1 / GPT-5.5 return base64 — configure FTP below to auto-upload and get a public URL.</p>
        </div>

        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 mb-2">FTP Image Hosting <span className="font-normal text-gray-400">(for GPT Image 1 / GPT-5.5)</span></p>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 block mb-1">FTP Host</label>
                <input type="text" value={ftpHost} onChange={e => setFtpHost(e.target.value)}
                  placeholder="ftp.example.com"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Username</label>
                <input type="text" value={ftpUser} onChange={e => setFtpUser(e.target.value)}
                  placeholder="ftpuser"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Password</label>
              <input type="password" value={ftpPass} onChange={e => setFtpPass(e.target.value)}
                placeholder="••••••••"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Upload Path</label>
              <input type="text" value={ftpPath} onChange={e => setFtpPath(e.target.value)}
                placeholder="/public_html/uploads/"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Public URL Base</label>
              <input type="text" value={ftpPublicUrl} onChange={e => setFtpPublicUrl(e.target.value)}
                placeholder="https://example.com/uploads"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
              <p className="text-[11px] text-gray-400 mt-1">The HTTP URL where uploaded files are publicly accessible.</p>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={verifyFtp} disabled={ftpVerifying || !ftpHost}
                className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {ftpVerifying ? 'Testing…' : 'Verify FTP'}
              </button>
              {ftpVerifyMsg && (
                <span className={`text-xs ${ftpVerifyMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {ftpVerifyMsg.ok ? '✓ ' : '✗ '}{ftpVerifyMsg.message}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {oauthMsg && (
        <p className={`text-xs ${oauthStatus === 'done' ? 'text-green-600' : oauthStatus === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
          {oauthStatus === 'waiting' ? '⏳ ' : ''}{oauthMsg}
        </p>
      )}

      <div className="flex gap-2 pt-1 flex-wrap">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
        <button onClick={connect} disabled={oauthStatus === 'waiting' || !appId}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition">
          <span>📸</span>
          {oauthStatus === 'waiting' ? 'Connecting…' : connectedUsername ? 'Reconnect Instagram' : 'Connect with Instagram'}
        </button>
      </div>
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
