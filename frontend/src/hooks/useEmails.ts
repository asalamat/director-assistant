import { useState, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { EmailSummary, EmailMessage, AIRecommendation } from '../types'

export type SortBy = 'date' | 'sender' | 'subject'
export type SortOrder = 'asc' | 'desc'

interface ListParams {
  folder?: string
  q?: string
  sort_by?: SortBy
  sort_order?: SortOrder
  from_date?: string
}

export function useEmails(defaultFolder = 'INBOX') {
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const skipRef = useRef(0)
  const paramsRef = useRef<ListParams>({ folder: defaultFolder, sort_by: 'date', sort_order: 'desc' })

  const load = useCallback(async (reset = false, overrides?: Partial<ListParams>) => {
    if (overrides) paramsRef.current = { ...paramsRef.current, ...overrides }
    const skip = reset ? 0 : skipRef.current
    setLoading(true)
    setError('')
    try {
      const res = await api.listEmails({ skip, limit: 50, ...paramsRef.current })
      setEmails((prev) => (reset ? res.emails : [...prev, ...res.emails]))
      setTotal(res.total)
      setHasMore(res.has_more)
      skipRef.current = skip + res.emails.length
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load emails')
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback((overrides?: Partial<ListParams>) => {
    skipRef.current = 0
    load(true, overrides)
  }, [load])

  const loadMore = useCallback(() => load(false), [load])

  const setSort = useCallback((sort_by: SortBy, sort_order: SortOrder) => {
    refresh({ sort_by, sort_order })
  }, [refresh])

  const removeEmail = useCallback((id: string) => {
    setEmails((prev) => prev.filter((e) => e.id !== id))
    setTotal((prev) => Math.max(0, prev - 1))
  }, [])

  return {
    emails, total, hasMore, loading, error,
    refresh, loadMore, setSort, removeEmail,
    currentParams: paramsRef.current,
  }
}

export function useEmailDetail() {
  const [email, setEmail] = useState<EmailMessage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetch = useCallback(async (id: string, folder = 'INBOX') => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getEmail(id, folder)
      setEmail(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load email')
    } finally {
      setLoading(false)
    }
  }, [])

  return { email, loading, error, fetch }
}

export function useRecommendation() {
  const [rec, setRec] = useState<AIRecommendation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetch = useCallback(async (id: string, folder = 'INBOX') => {
    setLoading(true)
    setError('')
    setRec(null)
    try {
      const data = await api.getRecommendation(id, folder)
      setRec(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'AI analysis failed')
    } finally {
      setLoading(false)
    }
  }, [])

  return { rec, loading, error, fetch }
}
