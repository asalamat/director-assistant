import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import { useUIContext } from '../contexts/UIContext'
import type { NewsArticle } from '../types'

const REFRESH_MS = 10 * 60 * 1000  // 10 minutes

function timeAgo(published: string): string {
  if (!published) return ''
  const d = new Date(published)
  if (isNaN(d.getTime())) return published
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function relevanceBadge(score: number): string {
  if (score >= 8) return 'bg-green-100 text-green-700 border-green-200'
  if (score >= 5) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-gray-100 text-gray-500 border-gray-200'
}

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-4 animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/3 mb-3" />
      <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-full" />
    </div>
  )
}

export function NewsPanel() {
  const { setShowSettings, setSettingsInitialTab } = useUIContext()
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [enabled, setEnabled] = useState(true)
  const [hint, setHint] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [nextRefreshAt, setNextRefreshAt] = useState(Date.now() + REFRESH_MS)
  const [now, setNow] = useState(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  type AISummary = { what: string; why: string; takeaway: string }

  // Selection + summarize state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [summarizing, setSummarizing] = useState(false)
  const [aiSummaries, setAiSummaries] = useState<Record<string, AISummary>>({})
  const [summarizeError, setSummarizeError] = useState('')

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true)
    setError('')
    try {
      const res = force ? await api.refreshNews() : await api.getNews()
      setEnabled(res.enabled)
      setArticles(res.articles)
      setHint(res.hint ?? '')
      setNextRefreshAt(Date.now() + REFRESH_MS)
      setSelected(new Set())
      setAiSummaries({})
    } catch {
      setError('Failed to load news')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
    timerRef.current = setInterval(() => load(), REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 30000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      clearInterval(tick)
    }
  }, [load])

  const topics = Array.from(new Set(articles.map(a => a.topic)))
  const shown = activeTopic ? articles.filter(a => a.topic === activeTopic) : articles
  const minsLeft = Math.max(0, Math.ceil((nextRefreshAt - now) / 60000))

  const openNewsSettings = () => {
    setSettingsInitialTab('config')
    setShowSettings(true)
  }

  const toggleSelect = (url: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(shown.map(a => a.url)))
  const clearSelection = () => setSelected(new Set())

  const handleSummarize = async () => {
    const toSummarize = articles.filter(a => selected.has(a.url))
    if (!toSummarize.length) return
    setSummarizing(true)
    setSummarizeError('')
    try {
      const res = await api.summarizeNews(
        toSummarize.map(a => ({ url: a.url, title: a.title, body: a.body }))
      )
      const map: Record<string, AISummary> = {}
      for (const s of res.summaries) {
        if (s.url && s.what) map[s.url] = { what: s.what, why: s.why, takeaway: s.takeaway }
      }
      setAiSummaries(prev => ({ ...prev, ...map }))
    } catch {
      setSummarizeError('Failed to summarize — check AI settings.')
    } finally {
      setSummarizing(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-surface-1 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Daily News</h1>
            <p className="text-xs text-gray-400">
              {articles.length > 0
                ? `${articles.length} article${articles.length !== 1 ? 's' : ''} · next refresh in ${minsLeft} min`
                : 'AI-scored headlines for your topics'}
            </p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {/* Topic filter chips */}
        {topics.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button
              onClick={() => setActiveTopic(null)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                activeTopic === null
                  ? 'bg-accent text-white border-accent'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >All</button>
            {topics.map(t => (
              <button
                key={t}
                onClick={() => setActiveTopic(activeTopic === t ? null : t)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  activeTopic === t
                    ? 'bg-accent text-white border-accent'
                    : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >{t}</button>
            ))}
          </div>
        )}

        {/* Selection toolbar — shown only when articles are present */}
        {!loading && !error && shown.length > 0 && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <button
              onClick={selected.size === shown.length ? clearSelection : selectAll}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-accent transition-colors underline"
            >
              {selected.size === shown.length ? 'Deselect all' : 'Select all'}
            </button>
            {selected.size > 0 && (
              <>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{selected.size} selected</span>
                <button
                  onClick={clearSelection}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline transition-colors"
                >Clear</button>
                <button
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="ml-auto flex items-center gap-1.5 text-xs font-medium bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-60"
                >
                  {summarizing ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                      Summarizing…
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                      </svg>
                      Summarize {selected.size} article{selected.size !== 1 ? 's' : ''}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}

        {/* Summarize error */}
        {summarizeError && (
          <div className="mb-3 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            {summarizeError}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="text-center py-12">
            <p className="text-sm text-red-500 mb-3">{error}</p>
            <button onClick={() => load(true)} className="text-xs text-accent underline">Try again</button>
          </div>
        )}

        {/* Disabled / no topics */}
        {!loading && !error && (!enabled || (articles.length === 0 && hint)) && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📰</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {!enabled ? 'News feed is off' : 'No topics configured'}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              {!enabled
                ? 'Enable the news feed and add topics you care about.'
                : 'Add topics like "AI, finance, Toronto real estate" in Settings.'}
            </p>
            <button
              onClick={openNewsSettings}
              className="text-xs bg-accent text-white px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
            >
              Open Settings
            </button>
          </div>
        )}

        {/* Empty result */}
        {!loading && !error && enabled && articles.length === 0 && !hint && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📰</div>
            <p className="text-sm text-gray-500">No articles found — try a refresh or broader topics.</p>
          </div>
        )}

        {/* Article cards */}
        {!loading && !error && shown.length > 0 && (
          <div className="space-y-3">
            {shown.map((a, i) => {
              const isSelected = selected.has(a.url)
              const aiSummary = aiSummaries[a.url]
              return (
                <div
                  key={a.url || i}
                  className={`bg-white dark:bg-gray-800 border rounded-xl p-4 hover:shadow-sm transition-shadow cursor-pointer ${
                    isSelected
                      ? 'border-accent/50 ring-1 ring-accent/20 dark:border-accent/40'
                      : 'border-gray-100 dark:border-gray-700'
                  }`}
                  onClick={() => toggleSelect(a.url)}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className="flex-shrink-0 mt-0.5">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-accent border-accent'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                      }`}>
                        {isSelected && (
                          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-accent transition-colors leading-snug"
                        onClick={e => e.stopPropagation()}
                      >
                        {a.title}
                      </a>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                        {a.source && <span className="font-medium text-gray-500 dark:text-gray-400">{a.source}</span>}
                        {a.published && <span>· {timeAgo(a.published)}</span>}
                        <span className="px-1.5 py-0.5 rounded-full bg-gray-50 dark:bg-gray-700 text-gray-400 border border-gray-100 dark:border-gray-600">
                          {a.topic}
                        </span>
                      </div>

                      {/* Original short summary */}
                      {a.summary && !aiSummary && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{a.summary}</p>
                      )}

                      {/* AI-generated structured summary */}
                      {aiSummary && (
                        <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg space-y-1.5">
                          <div className="flex items-center gap-1 mb-2">
                            <svg className="w-3 h-3 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                            </svg>
                            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">AI Breakdown</span>
                          </div>
                          {aiSummary.what && (
                            <div className="flex gap-2">
                              <span className="flex-shrink-0 text-[10px] font-bold text-blue-500 dark:text-blue-400 uppercase w-16 pt-0.5">What</span>
                              <p className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">{aiSummary.what}</p>
                            </div>
                          )}
                          {aiSummary.why && (
                            <div className="flex gap-2">
                              <span className="flex-shrink-0 text-[10px] font-bold text-purple-500 dark:text-purple-400 uppercase w-16 pt-0.5">Why</span>
                              <p className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">{aiSummary.why}</p>
                            </div>
                          )}
                          {aiSummary.takeaway && (
                            <div className="flex gap-2">
                              <span className="flex-shrink-0 text-[10px] font-bold text-green-600 dark:text-green-400 uppercase w-16 pt-0.5">Takeaway</span>
                              <p className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">{aiSummary.takeaway}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <span
                      title={`Relevance: ${a.relevance}/10`}
                      className={`flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border ${relevanceBadge(a.relevance)}`}
                    >
                      {a.relevance}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
