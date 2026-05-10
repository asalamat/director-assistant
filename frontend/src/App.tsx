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
import { useEmails, useEmailDetail, useRecommendation } from './hooks/useEmails'
import { api } from './api/client'
import type { EmailSummary } from './types'

type Tab = 'inbox' | 'actions' | 'digest' | 'analytics' | 'templates'

const TABS: { id: Tab; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'actions', label: 'Actions' },
  { id: 'digest', label: 'Brief' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'templates', label: 'Templates' },
]

export default function App() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState<EmailSummary | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('inbox')

  const { emails, total, loading: listLoading, hasMore, refresh, loadMore, setSort, currentParams } = useEmails()
  const { email, loading: emailLoading, fetch: fetchEmail } = useEmailDetail()
  const { rec, loading: recLoading, error: recError, fetch: fetchRec } = useRecommendation()

  useEffect(() => {
    api.getStatus().then((s) => {
      setConnected(s.connected)
      if (s.connected) refresh()
    }).catch(() => setConnected(false))
  }, [])

  const handleConnected = () => {
    setConnected(true)
    setShowSettings(false)
    refresh()
  }

  const handleSelect = (summary: EmailSummary) => {
    setSelectedEmail(summary)
    fetchEmail(summary.id)
    setActiveTab('inbox')
  }

  const handleAnalyze = () => {
    if (selectedEmail) fetchRec(selectedEmail.id)
  }

  if (connected === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!connected || showSettings) {
    return <Settings onConnected={handleConnected} />
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="h-11 flex items-center justify-between px-4 border-b border-gray-200 bg-white flex-shrink-0">
        <span className="text-sm font-semibold text-gray-800">Director Assistant</span>
        <div className="flex gap-2">
          {activeTab === 'inbox' && (
            <button
              onClick={() => refresh()}
              className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            >
              ↻ Refresh
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          >
            ⚙ Settings
          </button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'inbox' && (
          <>
            {/* Email list — 260px */}
            <div className="w-64 flex-shrink-0">
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

            {/* Email viewer — flex-1 */}
            <EmailViewer
              email={email}
              loading={emailLoading}
              onAnalyze={handleAnalyze}
              analyzing={recLoading}
            />

            {/* AI panel — 320px */}
            <AIPanel rec={rec} loading={recLoading} error={recError} email={email} />
          </>
        )}

        {activeTab === 'actions' && <ActionBoard />}
        {activeTab === 'digest' && <DigestView />}
        {activeTab === 'analytics' && <Analytics />}
        {activeTab === 'templates' && <TemplatesPanel />}
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  )
}
