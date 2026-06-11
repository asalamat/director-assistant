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

interface Props {
  onConnected: () => void
  initialTab?: 'accounts' | 'config' | 'integrations'
}

const PROVIDER_LABELS: Record<EmailProvider, string> = {
  yahoo_imap: 'Yahoo Mail',
  gmail:      'Gmail',
  hotmail:    'Hotmail / Outlook.com',
  generic_imap: 'Generic IMAP',
  office365:  'Office 365 (work)',
}

const PROVIDER_HINTS: Record<EmailProvider, string> = {
  yahoo_imap:   'Use an App Password from Yahoo Account Security',
  gmail:        'Use an App Password (enable 2FA first in Google Account)',
  hotmail:      'Enable IMAP in Outlook Settings → Mail → Sync email, then use an App Password (requires 2FA on your Microsoft account)',
  generic_imap: 'Enter your IMAP server address',
  office365:    'Requires Tenant ID, Client ID, and Client Secret',
}

const IMAP_PROVIDERS: EmailProvider[] = ['yahoo_imap', 'gmail', 'hotmail', 'generic_imap']

function ProviderBadge({ provider }: { provider: EmailProvider }) {
  const colors: Record<EmailProvider, string> = {
    yahoo_imap:   'bg-purple-100 text-purple-700',
    gmail:        'bg-red-100 text-red-700',
    hotmail:      'bg-blue-100 text-blue-700',
    generic_imap: 'bg-gray-100 text-gray-700',
    office365:    'bg-teal-100 text-teal-700',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[provider]}`}>
      {PROVIDER_LABELS[provider]}
    </span>
  )
}

export function Settings({ onConnected, initialTab = 'accounts' }: Props) {
  const [settingsTab, setSettingsTab] = useState<'accounts' | 'config' | 'integrations'>(initialTab)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [provider, setProvider] = useState<EmailProvider>('gmail')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [ingestingId, setIngestingId] = useState<number | 'all' | null>(null)

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
  const [updateStatus, setUpdateStatus] = useState<{ checking?: boolean; msg?: string; available?: boolean; latest?: string } >({})

  // Microsoft OAuth2 state
  const [hotmailMode, setHotmailMode] = useState<'password' | 'oauth'>('password')
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle')
  const [oauthMsg, setOauthMsg] = useState('')
  const oauthPopupRef = useRef<Window | null>(null)

  // Google OAuth2 state
  const [gmailMode, setGmailMode] = useState<'password' | 'oauth'>('password')
  const [googleOauthStatus, setGoogleOauthStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle')
  const [googleOauthMsg, setGoogleOauthMsg] = useState('')
  const googlePopupRef = useRef<Window | null>(null)

  const handleMicrosoftSignIn = async () => {
    setOauthStatus('waiting'); setOauthMsg(''); setError('')
    try {
      const { url } = await api.getMicrosoftAuthUrl(username.trim() || undefined)
      const popup = window.open(url, 'msauth', 'width=520,height=680,left=200,top=80')
      oauthPopupRef.current = popup

      if (!popup) {
        setOauthStatus('error')
        setOauthMsg('Popup was blocked — please allow popups for this page and try again.')
        return
      }

      const onMsg = async (e: MessageEvent) => {
        if (e.data?.type === 'oauth-complete') {
          window.removeEventListener('message', onMsg)
          setOauthStatus('done')
          setOauthMsg(`Signed in as ${e.data.username || 'Microsoft account'} — importing emails…`)
          await loadAccounts()
          setTimeout(() => { setShowAdd(false); setOauthStatus('idle'); setOauthMsg(''); setUsername('') }, 2500)
        } else if (e.data?.type === 'oauth-error') {
          window.removeEventListener('message', onMsg)
          setOauthStatus('error')
          setOauthMsg(e.data.message || 'Sign-in failed — please try again.')
        }
      }
      window.addEventListener('message', onMsg)

      const checkClosed = setInterval(() => {
        if (oauthPopupRef.current?.closed) {
          clearInterval(checkClosed)
          window.removeEventListener('message', onMsg)
          setOauthStatus(s => s === 'waiting' ? 'idle' : s)
        }
      }, 800)
    } catch (e: unknown) {
      setOauthStatus('error')
      setOauthMsg(e instanceof Error ? e.message : 'Failed to start sign-in')
    }
  }


  const handleGoogleSignIn = async () => {
    setGoogleOauthStatus('waiting'); setGoogleOauthMsg(''); setError('')
    try {
      const { url } = await api.getGoogleAuthUrl(username.trim() || undefined)
      const popup = window.open(url, 'gauth', 'width=520,height=680,left=200,top=80')
      googlePopupRef.current = popup
      if (!popup) {
        setGoogleOauthStatus('error')
        setGoogleOauthMsg('Popup was blocked — please allow popups for this page and try again.')
        return
      }
      const onMsg = async (e: MessageEvent) => {
        if (e.data?.type === 'oauth-complete') {
          window.removeEventListener('message', onMsg)
          setGoogleOauthStatus('done')
          setGoogleOauthMsg(`Signed in as ${e.data.username || 'Google account'} — importing emails…`)
          await loadAccounts()
          setTimeout(() => { setShowAdd(false); setGoogleOauthStatus('idle'); setGoogleOauthMsg(''); setUsername('') }, 2500)
        } else if (e.data?.type === 'oauth-error') {
          window.removeEventListener('message', onMsg)
          setGoogleOauthStatus('error')
          setGoogleOauthMsg(e.data.message || 'Sign-in failed — please try again.')
        }
      }
      window.addEventListener('message', onMsg)
      const checkClosed = setInterval(() => {
        if (googlePopupRef.current?.closed) {
          clearInterval(checkClosed)
          window.removeEventListener('message', onMsg)
          setGoogleOauthStatus(s => s === 'waiting' ? 'idle' : s)
        }
      }, 800)
    } catch (e: unknown) {
      setGoogleOauthStatus('error')
      setGoogleOauthMsg(e instanceof Error ? e.message : 'Failed to start sign-in')
    }
  }

  const loadAccounts = async () => {
    try {
      const accs = await api.getAccounts()
      setAccounts(accs)
    } catch {
      setAccounts([])
    }
  }

  useEffect(() => {
    loadAccounts()
    api.getDocumentFolders().then(r => setDocFolders(r.folders || [])).catch(() => {})
    api.listDocuments().then(r => setDocCount(r.total)).catch(() => {})
  }, [])

  const handleAdd = async () => {
    setLoading(true)
    setError('')
    try {
      const payload =
        provider === 'office365'
          ? { provider, username, tenant_id: tenantId, client_id: clientId, client_secret: clientSecret }
          : provider === 'generic_imap'
          ? { provider, username, password, imap_host: imapHost }
          : { provider, username, password }

      await api.addAccount(payload)
      await loadAccounts()
      setShowAdd(false)
      setUsername(''); setPassword(''); setImapHost(''); setTenantId(''); setClientId(''); setClientSecret('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to connect')
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (id: number) => {
    await api.removeAccount(id)
    await loadAccounts()
  }

  const handleConsolidate = async () => {
    try {
      const r = await api.consolidateAccounts()
      setError('')
      await loadAccounts()
      if (r.accounts_removed > 0) onConnected()
      alert(r.message)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Consolidate failed')
    }
  }

  const handleIngest = async (id: number | 'all') => {
    setIngestingId(id)
    setProgress({ total: 0, processed: 0, status: 'running', message: 'Starting…' })
    try {
      if (id === 'all') {
        await api.ingestAll(fromDate || undefined)
      } else {
        await api.ingestAccount(id, fromDate || undefined)
      }
      const es = api.subscribeAccountsIngestProgress((p) => {
        setProgress(p)
        if (p.status === 'completed' || p.status === 'error') {
          es.close()
          setIngestingId(null)
          if (p.status === 'completed') onConnected()
        }
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ingest failed')
      setIngestingId(null)
    }
  }

  const handleLegacyConnect = async () => {
    setLoading(true)
    setError('')
    try {
      const payload =
        provider === 'office365'
          ? { provider, username, tenant_id: tenantId, client_id: clientId, client_secret: clientSecret }
          : provider === 'generic_imap'
          ? { provider, username, password, imap_host: imapHost }
          : { provider, username, password }
      await api.connect(payload)
      await loadAccounts()
      onConnected()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  const hasAccounts = accounts.length > 0

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-lg p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Director Assistant</h1>
        <p className="text-gray-500 text-sm mb-4">Configure your assistant</p>

        {/* Tab bar */}
        <div className="flex border-b border-gray-200 mb-6">
          {(['accounts', 'config', 'integrations'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setSettingsTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                settingsTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab === 'accounts' ? 'Email Accounts' : tab === 'config' ? 'App Settings' : '🔗 Integrations'}
            </button>
          ))}
        </div>

        {settingsTab === 'config' && <ConfigPanel />}
        {settingsTab === 'config' && <TriageRulesPanel />}
        {settingsTab === 'integrations' && (
          <div className="space-y-6 py-4">
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Slack &amp; Teams</h3>
              <NotifySettings />
            </section>
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Webhooks / Zapier</h3>
              <WebhooksSettings />
            </section>
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Task Export</h3>
              <TasksExportSettings />
            </section>
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Overnight Triage Agent</h3>
              <OvernightTriageSettings />
            </section>
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Scheduled Report Email</h3>
              <ReportScheduleSettings />
            </section>
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Email Rules</h3>
              <EmailRulesPanel />
            </section>
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Data &amp; Backup</h3>
              <BackupSettings />
            </section>
          </div>
        )}

        {settingsTab === 'accounts' && <>

        {/* Account list */}
        {hasAccounts && (
          <div className="mb-6 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Connected accounts</p>
              {accounts.length > 1 && (() => {
                const usernames = accounts.map(a => (a.username || '').toLowerCase())
                const hasDupes = usernames.some((u, i) => usernames.indexOf(u) !== i)
                return hasDupes ? (
                  <button
                    onClick={handleConsolidate}
                    className="text-xs text-amber-600 hover:text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg px-2.5 py-1 transition-colors"
                    title="Merge duplicate accounts with the same email address"
                  >
                    ⚡ Consolidate duplicates
                  </button>
                ) : null
              })()}</div>
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl bg-gray-50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{acc.username}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <ProviderBadge provider={acc.provider} />
                    {acc.last_ingested && (
                      <span className="text-xs text-gray-400">
                        Ingested {new Date(acc.last_ingested).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleIngest(acc.id)}
                    disabled={ingestingId !== null}
                    className="text-xs text-accent hover:underline disabled:opacity-50"
                  >
                    {ingestingId === acc.id ? 'Importing…' : 'Import'}
                  </button>
                  <span className="text-gray-200">|</span>
                  <button onClick={() => handleRemove(acc.id)} className="text-xs text-gray-400 hover:text-red-500">
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {/* Date filter */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 whitespace-nowrap">From date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent bg-white"
              />
              {fromDate && (
                <button onClick={() => setFromDate('')} className="text-xs text-gray-400 hover:text-gray-600">
                  Clear
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 -mt-1">Leave blank to import all emails (no date limit).</p>

            {/* Global actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleIngest('all')}
                disabled={ingestingId !== null}
                className="flex-1 bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {ingestingId === 'all' ? 'Importing all…' : 'Import all emails'}
              </button>
              <button
                onClick={onConnected}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
              >
                Open app
              </button>
            </div>

            {/* Ingest progress */}
            {progress && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span className="truncate pr-2">{progress.message}</span>
                  {progress.total > 0 && (
                    <span className="flex-shrink-0">{progress.processed}/{progress.total}</span>
                  )}
                </div>
                {progress.total > 0 && (
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all"
                      style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }}
                    />
                  </div>
                )}
                {progress.status === 'completed' && (
                  <p className="text-xs text-green-600 mt-1">{progress.message}</p>
                )}
              </div>
            )}

            {/* Add more button */}
            <button
              onClick={() => setShowAdd(true)}
              className="w-full text-sm text-gray-500 hover:text-accent border border-dashed border-gray-300 rounded-lg py-2 hover:border-accent transition-colors"
            >
              + Add another account
            </button>
          </div>
        )}

        {/* Documents section */}
        {hasAccounts && !showAdd && (
          <div className="mb-6 space-y-3 border-t border-gray-100 pt-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Documents</p>
              {docCount !== null && docCount > 0 && (
                <span className="text-xs text-gray-400">{docCount} file{docCount !== 1 ? 's' : ''} indexed</span>
              )}
            </div>
            <p className="text-xs text-gray-400">Add folders to index — PDFs, Word, Excel, and text files are searchable alongside emails.</p>

            {/* Folder list */}
            {docFolders.length > 0 && (
              <div className="space-y-1.5">
                {docFolders.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                    <span className="flex-1 text-xs text-gray-700 truncate font-mono">{f}</span>
                    <button
                      onClick={async () => {
                        const next = docFolders.filter((_, j) => j !== i)
                        await api.setDocumentFolders(next).catch(() => {})
                        setDocFolders(next)
                      }}
                      className="text-xs text-gray-400 hover:text-red-500 flex-shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add folder button */}
            <button
              onClick={() => setShowFolderPicker(true)}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-amber-300 text-amber-600 hover:bg-amber-50 rounded-lg py-2 text-sm transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              Browse &amp; add folder…
            </button>

            <button
              onClick={async () => {
                setDocIngesting(true); setDocMsg('')
                try {
                  await api.ingestDocuments()
                  let waited = 0
                  const id = setInterval(async () => {
                    waited += 1500
                    const s = await api.getDocumentIngestStatus().catch(() => null)
                    if (!s || s.status !== 'running') {
                      clearInterval(id)
                      setDocMsg(s?.message || 'Done')
                      api.listDocuments().then(r => setDocCount(r.total)).catch(() => {})
                      setDocIngesting(false)
                    } else {
                      setDocMsg(s.message)
                    }
                    if (waited > 120000) { clearInterval(id); setDocIngesting(false) }
                  }, 1500)
                } catch (e: unknown) {
                  setDocMsg(e instanceof Error ? e.message : 'Failed')
                  setDocIngesting(false)
                }
              }}
              disabled={docIngesting || docFolders.length === 0}
              className="w-full bg-amber-500 text-white text-sm font-medium py-2 rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              {docIngesting ? 'Indexing…' : `Index Documents${docFolders.length > 1 ? ` (${docFolders.length} folders)` : ''}`}
            </button>
            {docMsg && (
              <p className={`text-xs ${docMsg.toLowerCase().includes('fail') || docMsg.toLowerCase().includes('error') ? 'text-red-500' : 'text-green-600'}`}>{docMsg}</p>
            )}

            <button
              onClick={async () => {
                setEmailReindexing(true); setEmailReindexMsg('')
                try {
                  await api.reindexEmails()
                  let waited = 0
                  const id = setInterval(async () => {
                    waited += 2000
                    const s = await api.getReindexEmailsStatus().catch(() => null)
                    if (!s || s.status !== 'running') {
                      clearInterval(id)
                      setEmailReindexMsg(s?.status === 'done' ? `Done — ${s.indexed} emails re-indexed` : s?.error || 'Done')
                      setEmailReindexing(false)
                    }
                    if (waited > 300000) { clearInterval(id); setEmailReindexing(false) }
                  }, 2000)
                } catch (e: unknown) {
                  setEmailReindexMsg(e instanceof Error ? e.message : 'Failed')
                  setEmailReindexing(false)
                }
              }}
              disabled={emailReindexing}
              className="w-full border border-gray-300 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {emailReindexing ? 'Rebuilding email index…' : 'Rebuild Email Index'}
            </button>
            {emailReindexMsg && (
              <p className={`text-xs ${emailReindexMsg.toLowerCase().includes('fail') || emailReindexMsg.toLowerCase().includes('error') ? 'text-red-500' : 'text-green-600'}`}>{emailReindexMsg}</p>
            )}

            {/* Updates */}
            <div className="border-t border-gray-100 pt-4 mt-2 mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Updates</p>
              <button
                onClick={async () => {
                  setUpdateStatus({ checking: true, msg: 'Checking…' })
                  try {
                    const res = await api.checkUpdate()
                    if (res.error) {
                      setUpdateStatus({ msg: `Check failed: ${res.error}` })
                    } else if (res.update_available && res.latest) {
                      setUpdateStatus({ available: true, latest: res.latest, msg: `Update available: v${res.latest}` })
                    } else {
                      setUpdateStatus({ msg: `Up to date (v${res.current})` })
                    }
                  } catch {
                    setUpdateStatus({ msg: 'Check failed — no network?' })
                  }
                }}
                disabled={updateStatus.checking}
                className="w-full border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {updateStatus.checking ? 'Checking…' : 'Check for Updates'}
              </button>
              {updateStatus.msg && (
                <p className={`text-xs mt-1 ${updateStatus.available ? 'text-blue-600' : 'text-gray-500'}`}>
                  {updateStatus.msg}
                </p>
              )}
              {updateStatus.available && (
                <button
                  onClick={async () => {
                    setUpdateStatus(s => ({ ...s, msg: 'Installing update…', checking: true }))
                    try {
                      const res = await api.applyUpdate()
                      setUpdateStatus({ msg: res.message })
                      setTimeout(() => window.location.reload(), 30_000)
                    } catch {
                      setUpdateStatus({ msg: 'Update failed. Check /tmp/director-assistant-update.log' })
                    }
                  }}
                  className="w-full mt-2 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Install v{updateStatus.latest}
                </button>
              )}
            </div>

            {/* Danger zone */}
            <div className="border-t border-red-100 pt-4 mt-2">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Danger Zone</p>

              {/* Document ingest */}
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">Re-index documents only (leaves emails untouched)</p>
                <button
                  onClick={async () => {
                    setDocIngesting(true)
                    setDocMsg('')
                    try {
                      await api.ingestDocuments()
                      setDocMsg('Document re-index started…')
                    } catch (e: unknown) {
                      setDocMsg(e instanceof Error ? e.message : 'Failed')
                      setDocIngesting(false)
                    }
                  }}
                  disabled={docIngesting}
                  className="w-full border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {docIngesting ? 'Re-indexing documents…' : 'Re-index Documents'}
                </button>
                {docMsg && <p className="text-xs mt-1 text-gray-500">{docMsg}</p>}
              </div>

              {!clearConfirm ? (
                <button
                  onClick={() => { setClearConfirm(true); setClearFromDate('') }}
                  disabled={clearing}
                  className="w-full border border-red-200 text-red-500 text-sm font-medium py-2 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  Clear Database &amp; Re-ingest
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    This will delete <strong>all cached emails and vectors</strong> then re-import. This cannot be undone.
                  </p>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Import emails from date (leave blank for all)</label>
                    <input
                      type="date"
                      value={clearFromDate}
                      onChange={e => setClearFromDate(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setClearing(true)
                        setClearMsg('')
                        setClearConfirm(false)
                        try {
                          const res = await api.clearAndReingest(clearFromDate || undefined)
                          const dateNote = clearFromDate ? ` from ${clearFromDate}` : ''
                          setClearMsg(`Cleared ${res.cleared} emails. Re-importing${dateNote} from ${res.accounts} account${res.accounts !== 1 ? 's' : ''}…`)
                          const es = api.subscribeAccountsIngestProgress((p) => {
                            if (p.status === 'completed' || p.status === 'error') {
                              es.close()
                              setClearing(false)
                              setClearMsg(p.message)
                              onConnected()
                            }
                          })
                        } catch (e: unknown) {
                          setClearMsg(e instanceof Error ? e.message : 'Failed')
                          setClearing(false)
                        }
                      }}
                      disabled={clearing}
                      className="flex-1 bg-red-500 text-white text-sm font-medium py-2 rounded-lg hover:bg-red-600 disabled:opacity-50"
                    >
                      {clearing ? 'Clearing…' : 'Yes, clear everything'}
                    </button>
                    <button
                      onClick={() => setClearConfirm(false)}
                      className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {clearMsg && (
                <p className={`text-xs mt-2 ${clearMsg.toLowerCase().includes('fail') || clearMsg.toLowerCase().includes('error') ? 'text-red-500' : 'text-gray-600'}`}>{clearMsg}</p>
              )}
            </div>
          </div>
        )}

        {/* Microsoft Services: OneDrive & Teams */}
        {hasAccounts && !showAdd && (
          <div className="mb-4 border-t border-gray-100 pt-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Microsoft Services</p>
              <span className="text-xs text-blue-500 font-medium">OneDrive · Teams</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Connect a Microsoft account to enable OneDrive recent files and Teams chat previews in the dashboard.
              Requires a free Azure app registration with <span className="font-mono bg-gray-100 px-1 rounded text-gray-600 text-[10px]">Files.Read</span> and <span className="font-mono bg-gray-100 px-1 rounded text-gray-600 text-[10px]">Chat.Read</span> permissions.
            </p>
            <button
              onClick={() => { setShowAdd(true); setProvider('hotmail'); setHotmailMode('oauth') }}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 rounded-lg py-2 text-sm transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Connect Microsoft Account
            </button>
          </div>
        )}

        {showFolderPicker && (
          <FolderPicker
            onSelect={async (path) => {
              if (docFolders.includes(path)) return
              const next = [...docFolders, path]
              await api.setDocumentFolders(next).catch(() => {})
              setDocFolders(next)
            }}
            onClose={() => setShowFolderPicker(false)}
          />
        )}

        {/* Add account form */}
        {(showAdd || !hasAccounts) && (
          <div className="space-y-4">
            {hasAccounts && (
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Add account</p>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as EmailProvider)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {Object.entries(PROVIDER_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">{PROVIDER_HINTS[provider]}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {provider === 'gmail' && (
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setGmailMode('password')}
                  className={`px-3 py-1.5 rounded-lg border transition-colors ${gmailMode === 'password' ? 'bg-accent text-white border-accent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  App Password
                </button>
                <button
                  onClick={() => setGmailMode('oauth')}
                  className={`px-3 py-1.5 rounded-lg border transition-colors ${gmailMode === 'oauth' ? 'bg-accent text-white border-accent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  Sign in with Google (OAuth2)
                </button>
              </div>
            )}

            {provider === 'hotmail' && (
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setHotmailMode('password')}
                  className={`px-3 py-1.5 rounded-lg border transition-colors ${hotmailMode === 'password' ? 'bg-accent text-white border-accent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  App Password
                </button>
                <button
                  onClick={() => setHotmailMode('oauth')}
                  className={`px-3 py-1.5 rounded-lg border transition-colors ${hotmailMode === 'oauth' ? 'bg-accent text-white border-accent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  Sign in with Microsoft (OAuth2)
                </button>
              </div>
            )}

            {provider === 'gmail' && gmailMode === 'oauth' && (
              <div className="space-y-3">
                {googleOauthStatus === 'idle' && (
                  <button onClick={handleGoogleSignIn}
                    className="w-full flex items-center justify-center gap-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm">
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Sign in with Google
                  </button>
                )}
                {googleOauthStatus === 'waiting' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-blue-700 font-medium">
                      <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      Sign in with your Google account in the popup
                    </div>
                    <button onClick={handleGoogleSignIn}
                      className="w-full text-xs border border-blue-300 text-blue-700 bg-white rounded-lg py-1.5 hover:bg-blue-50">
                      Reopen Sign-in Window
                    </button>
                  </div>
                )}
                {googleOauthStatus === 'done' && (
                  <p className="text-sm text-green-600 font-medium bg-green-50 border border-green-200 rounded-lg px-4 py-3">{googleOauthMsg}</p>
                )}
                {googleOauthStatus === 'error' && (
                  <div className="space-y-2">
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{googleOauthMsg}</p>
                    <button onClick={handleGoogleSignIn}
                      className="w-full flex items-center justify-center gap-2.5 bg-red-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-red-700 transition-colors">
                      Try Again
                    </button>
                  </div>
                )}
              </div>
            )}

            {IMAP_PROVIDERS.includes(provider) && (provider !== 'hotmail' || hotmailMode === 'password') && (provider !== 'gmail' || gmailMode === 'password') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">App password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}

            {provider === 'hotmail' && hotmailMode === 'oauth' && (
              <div className="space-y-3">
                {oauthStatus === 'idle' && (
                  <button
                    onClick={handleMicrosoftSignIn}
                    className="w-full flex items-center justify-center gap-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                      <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                      <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                    </svg>
                    Sign in with Microsoft
                  </button>
                )}
                {oauthStatus === 'waiting' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm text-blue-700 font-medium">
                      <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      Sign in with your Microsoft account in the popup
                    </div>
                    <p className="text-xs text-blue-600">Enter your email, password, and complete MFA if prompted. Then approve the requested permissions.</p>
                    <button
                      onClick={() => handleMicrosoftSignIn()}
                      className="w-full text-xs border border-blue-300 text-blue-700 bg-white rounded-lg py-1.5 hover:bg-blue-50"
                    >
                      Reopen Sign-in Window
                    </button>
                  </div>
                )}
                {oauthStatus === 'done' && (
                  <p className="text-sm text-green-600 font-medium bg-green-50 border border-green-200 rounded-lg px-4 py-3">{oauthMsg}</p>
                )}
                {oauthStatus === 'error' && (
                  <div className="space-y-2">
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{oauthMsg}</p>
                    <button
                      onClick={handleMicrosoftSignIn}
                      className="w-full flex items-center justify-center gap-2.5 bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                        <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                        <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                        <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                        <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                      </svg>
                      Try Again
                    </button>
                  </div>
                )}
              </div>
            )}

            {provider === 'generic_imap' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IMAP server</label>
                <input
                  value={imapHost}
                  onChange={(e) => setImapHost(e.target.value)}
                  placeholder="imap.example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}

            {provider === 'office365' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tenant ID</label>
                  <input value={tenantId} onChange={(e) => setTenantId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                  <input value={clientId} onChange={(e) => setClientId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                  <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
              </>
            )}

            {error && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2">
              {!((provider === 'hotmail' && hotmailMode === 'oauth') || (provider === 'gmail' && gmailMode === 'oauth')) && (
              <button
                onClick={hasAccounts ? handleAdd : handleLegacyConnect}
                disabled={loading || !username || (IMAP_PROVIDERS.includes(provider) && provider !== 'hotmail' && provider !== 'gmail' && !password) || ((provider === 'hotmail' && hotmailMode === 'password') && !password) || ((provider === 'gmail' && gmailMode === 'password') && !password)}
                className="flex-1 bg-accent text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
              >
                {loading ? 'Connecting…' : 'Connect'}
              </button>
              )}
              {hasAccounts && (
                <button onClick={() => setShowAdd(false)}
                  className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
              )}
            </div>

          </div>
        )}
        </>}
      </div>
    </div>
  )
}

function TriageRulesPanel() {
  const [rules, setRules] = useState<{ id: number; rule: string }[]>([])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getTriageRules().then(setRules).catch(() => {})
  }, [])

  const add = async () => {
    if (!input.trim() || saving) return
    setSaving(true)
    try {
      const r = await api.addTriageRule(input.trim())
      setRules(prev => [...prev, r])
      setInput('')
    } finally { setSaving(false) }
  }

  const remove = async (id: number) => {
    await api.deleteTriageRule(id).catch(() => {})
    setRules(prev => prev.filter(r => r.id !== id))
  }

  return (
    <div className="mt-6 border border-gray-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-gray-700 mb-1">Smart Triage Rules</p>
      <p className="text-xs text-gray-400 mb-3">
        Define rules in plain English. Examples: "from: ceo@corp.com → critical" · "subject contains: invoice → urgent" · "invoice in subject → high"
      </p>
      <div className="flex gap-2 mb-3">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="from: board@company.com → critical"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={add}
          disabled={saving || !input.trim()}
          className="text-sm bg-accent text-white rounded-lg px-4 py-2 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {rules.length === 0 && <p className="text-xs text-gray-300 italic">No rules yet — triage uses built-in signals only.</p>}
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
