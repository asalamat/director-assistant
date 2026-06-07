import { createContext, useContext, useState, type ReactNode } from 'react'

type Tab = 'inbox' | 'actions' | 'digest' | 'analytics' | 'templates' | 'health' | 'ask' | 'knowledge' | 'triage' | 'weekly' | 'vip' | 'chase' | 'projects'

interface UIContextValue {
  activeTab: Tab
  setActiveTab: (t: Tab) => void
  showCompose: boolean
  setShowCompose: (v: boolean) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void
  settingsInitialTab: 'accounts' | 'config'
  setSettingsInitialTab: (t: 'accounts' | 'config') => void
  showHelp: boolean
  setShowHelp: (v: boolean) => void
  askContext: string
  setAskContext: (s: string) => void
}

const UIContext = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<Tab>('inbox')
  const [showCompose, setShowCompose] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'accounts' | 'config'>('accounts')
  const [showHelp, setShowHelp] = useState(false)
  const [askContext, setAskContext] = useState('')

  return (
    <UIContext.Provider value={{
      activeTab, setActiveTab,
      showCompose, setShowCompose,
      showSettings, setShowSettings,
      settingsInitialTab, setSettingsInitialTab,
      showHelp, setShowHelp,
      askContext, setAskContext,
    }}>
      {children}
    </UIContext.Provider>
  )
}

export function useUIContext() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUIContext must be inside UIProvider')
  return ctx
}
