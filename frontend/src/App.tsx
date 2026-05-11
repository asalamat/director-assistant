import { useState, useEffect } from 'react'
import { Settings } from './components/Settings'
import { EmailList } from './components/EmailList'
import { EmailViewer } from './components/EmailViewer'
import { AIPanel } from './components/AIPanel'
import { StatusBar } from './components/StatusBar'
import { DigestView } from './components/DigestView'
import { ActionBoard } from './components/ActionBoard'
import { Analytics } from './components/Analytics'
import { TemplatesPanel } from './components/TemplatesPanel'
import { HealthPanel } from './components/HealthPanel'
import { HelpModal } from './components/HelpModal'
import { useEmails, useEmailDetail, useRecommendation } from './hooks/useEmails'
import { api } from './api/client'
import type { EmailSummary } from './types'

type Tab = 'inbox' | 'actions' | 'digest' | 'analytics' | 'templates' | 'health'

// Simple SVG icons
const Icons: Record<Tab, JSX.Element> = {
  inbox: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
    </svg>
  ),
  actions: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
    </svg>
  ),
  digest: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  ),
  analytics: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
    </svg>
  ),
  templates: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" />
    </svg>
  ),
  health: (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
    </svg>
  ),
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'actions', label: 'Actions' },
  { id: 'digest', label: 'Brief' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'templates', label: 'Templates' },
  { id: 'health', label: 'Health' },
]

export default function App() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'accounts' | 'config'>('accounts')
  const [healthStatus, setHealthStatus] = useState<'ok' | 'degraded' | 'error' | null>(null)
  const [selectedEmail, setSelectedEmail] = useState<EmailSummary | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('inbox')
  const [accounts, setAccounts] = useState<{ id: number; username: string; provider: string }[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [importPrompt, setImportPrompt] = useState(false)
  const [importSubject, setImportSubject] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')

  const { emails, total, loading: listLoading, hasMore, refresh, mergeRefresh, loadMore, setSort, currentParams, removeEmail } = useEmails()
  const { email, loading: emailLoading, fetch: fetchEmail } = useEmailDetail()
  const { rec, loading: recLoading, error: recError, fetch: fetchRec } = useRecommendation()

  useEffect(() => {
    api.getStatus().then((s) => {
      setConnected(s.connected)
      if (s.connected) refresh()
    }).catch(() => setConnected(false))
    api.getAccounts().then(setAccounts).catch(() => {})
  }, [])

  useEffect(() => {
    const check = () =>
      fetch('/api/health/full?check_imap=false')
        .then(r => r.json())
        .then(d => setHealthStatus(d.overall))
        .catch(() => setHealthStatus('error'))
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [])

  const handleConnected = () => {
    setConnected(true)
    setShowSettings(false)
    refresh()
    api.getAccounts().then(setAccounts).catch(() => {})
  }

  const handleSelect = (summary: EmailSummary) => {
    setSelectedEmail(summary)
    fetchEmail(summary.id)
    setActiveTab('inbox')
  }

  const handleAnalyze = () => {
    if (selectedEmail) fetchRec(selectedEmail.id)
  }

  const handleImport = async () => {
    if (!importSubject.trim()) return
    setImporting(true)
    setImportMsg('')
    try {
      const res = await api.importBySubject(importSubject.trim())
      if (res.count > 0) {
        setImportMsg(`Imported ${res.count} email${res.count !== 1 ? 's' : ''}`)
        await mergeRefresh()
      } else {
        setImportMsg('No matching emails found')
      }
    } catch {
      setImportMsg('Import failed')
    } finally {
      setImporting(false)
      setTimeout(() => { setImportPrompt(false); setImportSubject(''); setImportMsg('') }, 2000)
    }
  }

  const handleDelete = async (emailId: string) => {
    try {
      await api.deleteEmail(emailId)
      removeEmail(emailId)
      setSelectedEmail(null)
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMsg('Checking mailboxes…')
    try {
      const before = await api.getStats().catch(() => null)
      const prevChecked = (before as any)?.poll?.last_checked ?? ''
      await api.pollNow()

      let waited = 0
      const tick = 2000
      const maxWait = 45000
      await new Promise<void>((resolve) => {
        const id = setInterval(async () => {
          waited += tick
          try {
            const s = await api.getStats() as any
            const newFound = s?.poll?.last_new ?? 0
            if (s?.poll?.last_checked !== prevChecked) {
              clearInterval(id)
              await mergeRefresh()
              setRefreshMsg(newFound > 0 ? `+${newFound} new email${newFound !== 1 ? 's' : ''}` : 'Up to date')
              setTimeout(() => setRefreshMsg(''), 3000)
              resolve()
            }
          } catch { /* ignore */ }
          if (waited >= maxWait) {
            clearInterval(id)
            await refresh()
            setRefreshMsg('Done')
            setTimeout(() => setRefreshMsg(''), 2000)
            resolve()
          }
        }, tick)
      })
    } catch {
      setRefreshMsg('Check failed')
      setTimeout(() => setRefreshMsg(''), 2000)
    } finally {
      setRefreshing(false)
    }
  }

  if (connected === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!connected || showSettings) {
    return <Settings onConnected={handleConnected} initialTab={settingsInitialTab} />
  }

  // Health dot color
  const healthDotClass =
    healthStatus === 'ok' ? 'text-green-500' :
    healthStatus === 'degraded' ? 'text-orange-400' :
    healthStatus === 'error' ? 'text-red-500' : 'text-gray-300'

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="h-11 flex items-center justify-between px-4 border-b border-gray-200 bg-white flex-shrink-0">
        <span className="text-sm font-semibold text-gray-800">Director Assistant</span>
        <div className="flex gap-2">
          {activeTab === 'inbox' && (
            <>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors disabled:opacity-60 flex items-center gap-1"
              >
                <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
                <span>{refreshMsg || 'Refresh'}</span>
              </button>
              <button
                onClick={() => setImportPrompt(true)}
                title="Import a specific email by subject"
                className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                <span>Import</span>
              </button>
            </>
          )}
          <button
            onClick={() => setShowHelp(true)}
            title="Help"
            className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
            </svg>
            <span>Help</span>
          </button>
          <button
            onClick={() => { setSettingsInitialTab('accounts'); setShowSettings(true) }}
            className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.id === 'health' ? (
              <span className={healthDotClass}>
                {Icons.health}
              </span>
            ) : Icons[tab.id]}
            <span>{tab.label}</span>
            {tab.id === 'health' && healthStatus && (
              <span className={`ml-0.5 w-1.5 h-1.5 rounded-full inline-block ${
                healthStatus === 'ok' ? 'bg-green-500' :
                healthStatus === 'degraded' ? 'bg-orange-400' : 'bg-red-500'
              }`} />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'inbox' && (
          <>
            <div className="w-64 flex-shrink-0 flex flex-col">
              {accounts.length > 1 && (
                <div className="flex flex-wrap gap-1 px-2 pt-2 pb-1 border-b border-gray-100">
                  <button
                    onClick={() => { setSelectedAccountId(null); refresh({ account_id: undefined }) }}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${selectedAccountId === null ? 'bg-accent text-white border-accent' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                  >All</button>
                  {accounts.map(acc => (
                    <button
                      key={acc.id}
                      onClick={() => {
                        const next = selectedAccountId === acc.id ? null : acc.id
                        setSelectedAccountId(next)
                        refresh({ account_id: next ?? undefined })
                      }}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors truncate max-w-[120px] ${selectedAccountId === acc.id ? 'bg-accent text-white border-accent' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                      title={acc.username}
                    >
                      {acc.username.split('@')[0]}
                    </button>
                  ))}
                </div>
              )}
              <EmailList
                emails={emails}
                total={total}
                selectedId={selectedEmail?.id ?? null}
                loading={listLoading}
                hasMore={hasMore}
                onSelect={handleSelect}
                onLoadMore={loadMore}
                onSearch={(q) => refresh({ q })}
                onSort={(by, order) => setSort(by, order)}
                sortBy={currentParams.sort_by ?? 'date'}
                sortOrder={currentParams.sort_order ?? 'desc'}
              />
            </div>

            <EmailViewer
              email={email}
              loading={emailLoading}
              onAnalyze={handleAnalyze}
              analyzing={recLoading}
              onDelete={handleDelete}
            />

            <AIPanel rec={rec} loading={recLoading} error={recError} email={email} />
          </>
        )}

        {activeTab === 'actions' && <ActionBoard />}
        {activeTab === 'digest' && <DigestView />}
        {activeTab === 'analytics' && <Analytics />}
        {activeTab === 'templates' && <TemplatesPanel />}
        {activeTab === 'health' && <HealthPanel />}
      </div>

      {/* Import by subject modal */}
      {importPrompt && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setImportPrompt(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-96" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Import email by subject</h3>
            <p className="text-xs text-gray-500 mb-3">Searches all folders (INBOX, Sent, Bulk, Spam) across all accounts</p>
            <input
              autoFocus
              type="text"
              value={importSubject}
              onChange={e => setImportSubject(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleImport()}
              placeholder="Paste the subject line…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent mb-3"
            />
            {importMsg && (
              <p className={`text-xs mb-3 ${importMsg.includes('failed') || importMsg.includes('No matching') ? 'text-red-500' : 'text-green-600'}`}>
                {importMsg}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setImportPrompt(false)} className="text-xs text-gray-500 px-3 py-1.5 rounded hover:bg-gray-100">Cancel</button>
              <button
                onClick={handleImport}
                disabled={importing || !importSubject.trim()}
                className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1"
              >
                {importing ? <><span className="animate-spin">⟳</span> Searching…</> : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <StatusBar />
    </div>
  )
}
