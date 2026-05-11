import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { EmailProvider, Account, IngestProgress } from '../types'
import { ConfigPanel } from './ConfigPanel'

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
  hotmail:      'Use an App Password from Microsoft Account Security',
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

  const loadAccounts = async () => {
    try {
      const accs = await api.getAccounts()
      setAccounts(accs)
    } catch {
      setAccounts([])
    }
  }

  useEffect(() => { loadAccounts() }, [])

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
        await api.ingestAll()
      } else {
        await api.ingestAccount(id)
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
                    {ingestingId === acc.id ? 'Ingesting…' : 'Ingest'}
                  </button>
                  <span className="text-gray-200">|</span>
                  <button onClick={() => handleRemove(acc.id)} className="text-xs text-gray-400 hover:text-red-500">
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {/* Global actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleIngest('all')}
                disabled={ingestingId !== null}
                className="flex-1 bg-accent text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {ingestingId === 'all' ? 'Ingesting all…' : 'Ingest all accounts'}
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

            {IMAP_PROVIDERS.includes(provider) && (
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
              <button
                onClick={hasAccounts ? handleAdd : handleLegacyConnect}
                disabled={loading || !username || (IMAP_PROVIDERS.includes(provider) && !password)}
                className="flex-1 bg-accent text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
              >
                {loading ? 'Connecting…' : 'Connect'}
              </button>
              {hasAccounts && (
                <button onClick={() => setShowAdd(false)}
                  className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
              )}
            </div>

            {/* Date filter for ingest */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-2 bg-gray-50">
              <p className="text-xs font-medium text-gray-700">Ingest from date <span className="text-gray-400 font-normal">(optional)</span></p>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white"
              />
              <p className="text-xs text-gray-400">Leave blank to ingest all emails. Gmail and Yahoo require an App Password — enable 2FA first.</p>
            </div>
          </div>
        )}
        </>}
      </div>
    </div>
  )
}
