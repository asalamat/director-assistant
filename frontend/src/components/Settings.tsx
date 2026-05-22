import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { EmailProvider, Account, IngestProgress } from '../types'
import { ConfigPanel } from './ConfigPanel'
import { FolderPicker } from './FolderPicker'

interface Props {
  onConnected: () => void
  initialTab?: 'accounts' | 'config'
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
  const [settingsTab, setSettingsTab] = useState<'accounts' | 'config'>(initialTab)
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

  // Microsoft OAuth2 device flow state
  const [hotmailMode, setHotmailMode] = useState<'password' | 'oauth'>('password')
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthFlow, setOauthFlow] = useState<{
    flow_id: string; user_code: string; verification_uri: string
  } | null>(null)
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle')
  const [oauthMsg, setOauthMsg] = useState('')
  const oauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopOauthPoll = () => {
    if (oauthPollRef.current) { clearInterval(oauthPollRef.current); oauthPollRef.current = null }
  }

  const handleStartOAuth = async () => {
    if (!oauthClientId.trim() || !username.trim()) return
    setOauthStatus('idle'); setOauthMsg(''); setOauthFlow(null); setError('')
    try {
      const res = await api.startMicrosoftOAuth(oauthClientId.trim(), username.trim())
      setOauthFlow(res)
      setOauthStatus('waiting')
      stopOauthPoll()
      oauthPollRef.current = setInterval(async () => {
        try {
          const poll = await api.pollMicrosoftOAuth(res.flow_id)
          if (poll.status === 'completed' && poll.access_token) {
            stopOauthPoll()
            setOauthStatus('done')
            setOauthMsg('Signed in! Saving account…')
            // Add account with access_token (no password)
            await api.addAccount({
              provider: 'hotmail',
              username: username.trim(),
              client_id: oauthClientId.trim(),
              access_token: poll.access_token,
            })
            await loadAccounts()
            setShowAdd(false)
            setOauthFlow(null); setOauthStatus('idle'); setOauthMsg('')
            setUsername(''); setOauthClientId('')
          }
        } catch (e: unknown) {
          stopOauthPoll()
          setOauthStatus('error')
          setOauthMsg(e instanceof Error ? e.message : 'Sign-in failed')
        }
      }, 3000)
    } catch (e: unknown) {
      setOauthStatus('error')
      setOauthMsg(e instanceof Error ? e.message : 'Failed to start sign-in')
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
          {(['accounts', 'config'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setSettingsTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                settingsTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab === 'accounts' ? 'Email Accounts' : 'App Settings'}
            </button>
          ))}
        </div>

        {settingsTab === 'config' && <ConfigPanel />}

        {settingsTab === 'accounts' && <>

        {/* Account list */}
        {hasAccounts && (
          <div className="mb-6 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Connected accounts</p>
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

            {/* Danger zone */}
            <div className="border-t border-red-100 pt-4 mt-2">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Danger Zone</p>
              {!clearConfirm ? (
                <button
                  onClick={() => setClearConfirm(true)}
                  disabled={clearing}
                  className="w-full border border-red-200 text-red-500 text-sm font-medium py-2 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  Clear Database &amp; Re-ingest
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    This will delete <strong>all cached emails</strong> and re-import from scratch. This cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setClearing(true)
                        setClearMsg('')
                        setClearConfirm(false)
                        try {
                          const res = await api.clearAndReingest()
                          setClearMsg(`Cleared ${res.cleared} emails. Re-importing from ${res.accounts} account${res.accounts !== 1 ? 's' : ''}…`)
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

            {IMAP_PROVIDERS.includes(provider) && (provider !== 'hotmail' || hotmailMode === 'password') && (
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Azure App Client ID</label>
                  <input
                    value={oauthClientId}
                    onChange={e => setOauthClientId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Register a free app at <strong>portal.azure.com</strong> → Azure AD → App registrations → New → Personal accounts only → Authentication → Enable "Allow public client flows". Add API permission: Office 365 Exchange Online → IMAP.AccessAsUser.All (delegated).
                  </p>
                </div>

                {!oauthFlow && (
                  <button
                    onClick={handleStartOAuth}
                    disabled={!oauthClientId.trim() || !username.trim()}
                    className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
                  >
                    Start Sign In
                  </button>
                )}

                {oauthFlow && oauthStatus === 'waiting' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                    <p className="text-sm font-semibold text-blue-800">Step 1 — Open in your browser:</p>
                    <a href={oauthFlow.verification_uri} target="_blank" rel="noreferrer"
                       className="text-sm text-blue-600 underline break-all">{oauthFlow.verification_uri}</a>
                    <p className="text-sm font-semibold text-blue-800 pt-1">Step 2 — Enter this code:</p>
                    <p className="text-2xl font-mono font-bold text-blue-900 tracking-widest">{oauthFlow.user_code}</p>
                    <p className="text-xs text-blue-600 flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      Waiting for you to sign in…
                    </p>
                  </div>
                )}

                {oauthStatus === 'done' && (
                  <p className="text-sm text-green-600 font-medium">{oauthMsg}</p>
                )}
                {oauthStatus === 'error' && (
                  <p className="text-sm text-red-600">{oauthMsg}</p>
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
              {!(provider === 'hotmail' && hotmailMode === 'oauth') && (
              <button
                onClick={hasAccounts ? handleAdd : handleLegacyConnect}
                disabled={loading || !username || (IMAP_PROVIDERS.includes(provider) && provider !== 'hotmail' && !password) || (provider === 'hotmail' && hotmailMode === 'password' && !password)}
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
