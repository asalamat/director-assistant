import { useState } from 'react'
import { api } from '../api/client'
import type { EmailProvider, IngestProgress } from '../types'

interface Props {
  onConnected: () => void
}

export function Settings({ onConnected }: Props) {
  const [provider, setProvider] = useState<EmailProvider>('yahoo_imap')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [fromDate, setFromDate] = useState('')

  const handleConnect = async () => {
    setLoading(true)
    setError('')
    try {
      const payload =
        provider === 'office365'
          ? { provider, username, tenant_id: tenantId, client_id: clientId, client_secret: clientSecret }
          : { provider, username, password }
      await api.connect(payload)
      onConnected()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  const handleIngest = async () => {
    setLoading(true)
    setError('')
    try {
      await api.startIngestWithOptions({ from_date: fromDate || undefined })
      setProgress({ total: 0, processed: 0, status: 'running', message: 'Starting…' })
      const es = api.subscribeIngestProgress((p) => {
        setProgress(p)
        if (p.status === 'completed' || p.status === 'error') {
          es.close()
          setLoading(false)
        }
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ingest failed')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Director Assistant</h1>
        <p className="text-gray-500 text-sm mb-8">Connect your email to get started</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as EmailProvider)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="yahoo_imap">Yahoo Mail (IMAP)</option>
              <option value="generic_imap">Generic IMAP</option>
              <option value="office365">Office 365</option>
            </select>
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

          {provider !== 'office365' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                App password{' '}
                <span className="text-gray-400 font-normal">
                  {provider === 'yahoo_imap' ? '(Yahoo requires app password)' : ''}
                </span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          )}

          {provider === 'office365' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tenant ID</label>
                <input
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleConnect}
            disabled={loading || !username}
            className="w-full bg-accent text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors"
          >
            {loading ? 'Connecting…' : 'Connect'}
          </button>

          {progress && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{progress.message}</span>
                {progress.total > 0 && (
                  <span>{progress.processed}/{progress.total}</span>
                )}
              </div>
              {progress.total > 0 && (
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Digest controls */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
            <p className="text-sm font-medium text-gray-700">Digest settings</p>

            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Start from date{' '}
                <span className="text-gray-400">(leave blank for all emails)</span>
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white"
              />
            </div>

            <div className="text-xs text-gray-500 flex items-start gap-1.5">
              <span className="text-blue-400 mt-0.5">ℹ</span>
              <span>
                Ingests <strong>Inbox + Sent</strong> automatically. Continuous polling checks for new
                emails every 2 minutes after ingestion completes.
              </span>
            </div>

            {!progress ? (
              <button
                onClick={handleIngest}
                disabled={loading}
                className="w-full border border-gray-300 text-gray-700 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 bg-white"
              >
                {fromDate
                  ? `Ingest emails from ${fromDate}`
                  : 'Ingest all emails into RAG'}
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-gray-500">
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
                  <button
                    onClick={() => setProgress(null)}
                    className="text-xs text-accent hover:underline"
                  >
                    Run again with different date
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
