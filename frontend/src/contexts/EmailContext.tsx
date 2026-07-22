import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { EmailSummary, EmailMessage } from '../types'
import { useEmails, useEmailDetail } from '../hooks/useEmails'

interface EmailContextValue {
  // Email list state (from useEmails)
  emails: EmailSummary[]
  total: number
  loading: boolean
  hasMore: boolean
  currentParams: { sort_by?: string; sort_order?: string; only_unread?: boolean; folder?: string; q?: string; account_id?: number }
  refresh: (overrides?: object) => void
  mergeRefresh: () => Promise<void>
  loadMore: () => void
  setSort: (by: 'date' | 'sender' | 'subject', order: 'asc' | 'desc') => void
  removeEmail: (id: string) => void
  markEmailsRead: (ids: string[]) => void

  // Selected email (from useEmailDetail)
  selectedEmail: EmailSummary | null
  email: EmailMessage | null
  emailLoading: boolean
  emailError: string
  selectEmail: (summary: EmailSummary) => void
  clearSelectedEmail: () => void
  fetchEmail: (id: string) => void

  // Folder/account state
  currentFolder: string
  setCurrentFolder: (f: string) => void
  folders: Record<string, number>
  setFolders: (f: Record<string, number>) => void

  // Unread filter
  onlyUnread: boolean
  toggleUnread: () => void
  unreadCount: number
  setUnreadCount: (n: number) => void

  // Account selection
  selectedAccountId: number | null
  setSelectedAccountId: (id: number | null) => void
}

const EmailContext = createContext<EmailContextValue | null>(null)

export function EmailProvider({ children }: { children: ReactNode }) {
  const [selectedEmail, setSelectedEmail] = useState<EmailSummary | null>(null)
  const [currentFolder, setCurrentFolder] = useState('INBOX')
  const [folders, setFolders] = useState<Record<string, number>>({})
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)

  const { emails, total, loading, hasMore, refresh, mergeRefresh, loadMore, setSort, currentParams, removeEmail, markEmailsRead } = useEmails()
  const { email, loading: emailLoading, error: emailError, fetch: fetchEmail } = useEmailDetail()

  const selectEmail = useCallback((summary: EmailSummary) => {
    setSelectedEmail(summary)
    fetchEmail(summary.id)
  }, [fetchEmail])

  const clearSelectedEmail = useCallback(() => setSelectedEmail(null), [])

  const toggleUnread = useCallback(() => {
    const next = !onlyUnread
    setOnlyUnread(next)
    refresh({ only_unread: next || undefined })
  }, [onlyUnread, refresh])

  return (
    <EmailContext.Provider value={{
      emails, total, loading, hasMore, currentParams, refresh, mergeRefresh, loadMore, setSort, removeEmail, markEmailsRead,
      selectedEmail, email, emailLoading, emailError, selectEmail, clearSelectedEmail, fetchEmail,
      currentFolder, setCurrentFolder, folders, setFolders,
      onlyUnread, toggleUnread, unreadCount, setUnreadCount,
      selectedAccountId, setSelectedAccountId,
    }}>
      {children}
    </EmailContext.Provider>
  )
}

export function useEmailContext() {
  const ctx = useContext(EmailContext)
  if (!ctx) throw new Error('useEmailContext must be inside EmailProvider')
  return ctx
}
