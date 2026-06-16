import { useState, useRef, useEffect } from 'react'
import { api } from '../api/client'
import type { AskHistoryEntry } from '../types'

interface Source {
  email_id: string
  source_type?: string
  subject: string
  sender: string
  date: string
  filename?: string
  file_type?: string
  contact_email?: string
  contact_name?: string
  relevance_pct?: number
  snippet?: string
}

interface Message {
  role: 'user' | 'assistant'
  text: string
  sources?: Source[]
  streaming?: boolean
}

interface HistoryMessage {
  role: string
  content: string
}

interface TopicResult {
  email_id: string
  subject: string
  sender: string
  date: string
  text?: string
}

interface NLResult {
  email_id: string
  subject: string
  sender: string
  date: string
  preview?: string
}

interface DocsAnswer {
  answer: string
  sources: { filename: string; file_type: string }[]
}

interface SavedSearch { id: string; name: string; query: string }

function buildMarkdown(text: string, sources?: { subject?: string; sender?: string; date?: string; filename?: string }[]): string {
  let md = text
  if (sources && sources.length > 0) {
    md += '\n\n---\n**Sources:**\n'
    sources.forEach((s, i) => {
      const label = s.filename ?? s.subject ?? '(no subject)'
      const from = s.filename ? '' : (s.sender ? ` — ${s.sender}` : '')
      const date = s.date ? ` (${s.date})` : ''
      md += `${i + 1}. ${label}${from}${date}\n`
    })
  }
  return md
}

function downloadMd(content: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `answer-${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const terms = query.trim().split(/\s+/).filter(t => t.length > 2).slice(0, 5)
  if (!terms.length) return <>{text}</>
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        pattern.test(part)
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5 not-italic">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

const SUGGESTIONS = [
  'Who sent me the most emails this month?',
  'Are there any unresolved action items?',
  'What were the last emails about the Q3 report?',
]

export function AskPanel({ initialQuery, onClear }: { initialQuery?: string; onClear?: () => void } = {}) {
  const [mode, setMode] = useState<'ask' | 'topic' | 'smart-search' | 'docs'>('ask')
  const [messages, setMessages] = useState<Message[]>([])
  const [history, setHistory] = useState<HistoryMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyList, setHistoryList] = useState<AskHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [openSourcesIdx, setOpenSourcesIdx] = useState<Set<number>>(new Set())

  // Topic search state
  const [topicQuery, setTopicQuery] = useState('')
  const [topicLoading, setTopicLoading] = useState(false)
  const [topicResults, setTopicResults] = useState<TopicResult[] | null>(null)
  const [topicError, setTopicError] = useState('')

  // Smart search state
  const [nlQuery, setNlQuery] = useState('')
  const [nlLoading, setNlLoading] = useState(false)
  const [nlResults, setNlResults] = useState<NLResult[] | null>(null)
  const [nlFilters, setNlFilters] = useState<Record<string, string>>({})
  const [nlError, setNlError] = useState('')

  // Saved/pinned searches state
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => {
    try { return JSON.parse(localStorage.getItem('saved_searches') || '[]') }
    catch { return [] }
  })
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveName, setSaveName] = useState('')

  // Docs Q&A state
  const [docsQuery, setDocsQuery] = useState('')
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [docsAnswer, setDocsAnswer] = useState<DocsAnswer | null>(null)
  const [docsError, setDocsError] = useState('')

  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [docsAnswerCopied, setDocsAnswerCopied] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const lastInitial = useRef<string | undefined>(undefined)

  const copyMsg = (i: number, text: string, sources?: Source[]) => {
    navigator.clipboard.writeText(buildMarkdown(text, sources)).catch(() => {})
    setCopiedIdx(i)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await api.getAskHistory(50)
      setHistoryList(res.entries)
    } catch { /* ignore */ }
    setHistoryLoading(false)
  }

  const toggleHistory = () => {
    const next = !showHistory
    setShowHistory(next)
    if (next) loadHistory()
  }

  const loadHistoryEntry = (entry: AskHistoryEntry) => {
    setMessages([
      { role: 'user', text: entry.question },
      { role: 'assistant', text: entry.answer, sources: (() => {
        try { return JSON.parse(entry.results_json) } catch { return [] }
      })() },
    ])
    setHistory([
      { role: 'user', content: entry.question },
      { role: 'assistant', content: entry.answer },
    ])
    setShowHistory(false)
  }

  const submit = async (overrideQ?: string) => {
    const q = (overrideQ ?? input).trim()
    if (!q || loading) return

    setMessages(prev => [...prev, { role: 'user', text: q }])
    setInput('')
    setLoading(true)

    setMessages(prev => [...prev, { role: 'assistant', text: '', streaming: true }])

    let fullText = ''
    let sources: Source[] = []

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history: history.slice(-6), n_results: 15 }),
      })

      if (!response.ok) throw new Error(`Server error ${response.status}`)

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'token') {
              fullText += data.text
              setMessages(prev => {
                const msgs = [...prev]
                msgs[msgs.length - 1] = { role: 'assistant', text: fullText, streaming: true }
                return msgs
              })
            } else if (data.type === 'sources') {
              sources = data.sources
            }
          } catch { /* skip malformed SSE line */ }
        }
      }
    } catch (e: unknown) {
      fullText = `Error: ${e instanceof Error ? e.message : 'Request failed'}`
    }

    setMessages(prev => {
      const msgs = [...prev]
      msgs[msgs.length - 1] = { role: 'assistant', text: fullText, sources, streaming: false }
      return msgs
    })

    setHistory(prev => [
      ...prev,
      { role: 'user', content: q },
      { role: 'assistant', content: fullText },
    ])

    setLoading(false)
  }

  useEffect(() => {
    if (initialQuery && initialQuery !== lastInitial.current) {
      lastInitial.current = initialQuery
      onClear?.()
      submit(initialQuery)
    }
  }, [initialQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearChat = () => {
    setMessages([])
    setHistory([])
    setOpenSourcesIdx(new Set())
  }

  const handleTopicSearch = async () => {
    const q = topicQuery.trim()
    if (!q || topicLoading) return
    setTopicLoading(true)
    setTopicError('')
    setTopicResults(null)
    try {
      const res = await api.topicCluster(q, 15)
      setTopicResults(res.results)
      if (res.results.length === 0) {
        setTopicError('No related emails found for that topic.')
      }
    } catch (e: unknown) {
      setTopicError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setTopicLoading(false)
    }
  }

  const persistSaved = (list: SavedSearch[]) => {
    setSavedSearches(list)
    localStorage.setItem('saved_searches', JSON.stringify(list))
  }

  const saveSearch = () => {
    if (!saveName.trim() || !nlQuery.trim()) return
    const entry: SavedSearch = { id: Date.now().toString(), name: saveName.trim(), query: nlQuery.trim() }
    persistSaved([...savedSearches, entry])
    setShowSaveInput(false)
    setSaveName('')
  }

  const removeSaved = (id: string) => persistSaved(savedSearches.filter(s => s.id !== id))

  const handleNlSearchWith = async (q: string) => {
    if (!q.trim() || nlLoading) return
    setNlLoading(true)
    setNlError('')
    setNlResults(null)
    setNlFilters({})
    setShowSaveInput(false)
    try {
      const res = await api.nlSearch(q.trim())
      setNlResults(res.results)
      setNlFilters(res.filters || {})
      if (res.results.length === 0) setNlError('No emails matched your search.')
    } catch (e: unknown) {
      setNlError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setNlLoading(false)
    }
  }

  const handleNlSearch = async () => {
    await handleNlSearchWith(nlQuery)
  }

  const handleDocsAsk = async () => {
    const q = docsQuery.trim()
    if (!q || loadingDocs) return
    setLoadingDocs(true)
    setDocsError('')
    setDocsAnswer(null)
    try {
      const res = await api.askDocsOnly(q)
      setDocsAnswer(res)
    } catch (e: unknown) {
      setDocsError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoadingDocs(false)
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* History sidebar (ask mode only) */}
      {showHistory && mode === 'ask' && (
        <div className="w-56 flex-shrink-0 border-r border-gray-100 flex flex-col bg-gray-50">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">History</span>
            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {historyLoading && (
              <p className="text-xs text-gray-400 px-3 py-4">Loading…</p>
            )}
            {!historyLoading && historyList.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-4">No history yet</p>
            )}
            {historyList.map(entry => (
              <button
                key={entry.id}
                onClick={() => loadHistoryEntry(entry)}
                className="w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-white transition-colors group"
              >
                <p className="text-xs font-medium text-gray-700 truncate group-hover:text-accent">{entry.question}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(entry.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </p>
              </button>
            ))}
          </div>
          <button
            onClick={clearChat}
            className="px-3 py-2.5 text-xs text-gray-400 hover:text-accent border-t border-gray-200 text-center"
          >
            + New chat
          </button>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mode toggle */}
        <div className="flex border-b border-gray-100 px-4 pt-3 gap-4 overflow-x-auto flex-shrink-0">
          {(['ask', 'topic', 'smart-search', 'docs'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`pb-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${
                mode === m ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {m === 'ask' ? 'Ask AI' : m === 'topic' ? 'Topic Search' : m === 'smart-search' ? 'Smart Search' : 'Documents'}
            </button>
          ))}
        </div>

        {/* Ask mode */}
        {mode === 'ask' && (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <div className="text-4xl">✦</div>
                  <p className="text-sm font-medium text-gray-700">Ask anything about your emails</p>
                  <p className="text-xs text-gray-400 max-w-xs">
                    Remembers context — ask "what did she reply?" or "show me more from him" after a previous answer.
                  </p>
                  <div className="grid grid-cols-1 gap-2 mt-2 w-full max-w-sm">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => setInput(s)}
                        className="text-xs text-left px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[80%]">
                    <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-accent text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`}>
                      {msg.text}
                      {msg.streaming && (
                        <span className="inline-block text-gray-400 ml-0.5 align-middle animate-blink">▌</span>
                      )}
                    </div>
                    {!msg.streaming && msg.role === 'assistant' && msg.text && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => copyMsg(i, msg.text, msg.sources)}
                          className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 transition-colors flex items-center gap-1"
                        >
                          {copiedIdx === i ? '✓ Copied!' : '📋 Copy'}
                        </button>
                        <button
                          onClick={() => downloadMd(buildMarkdown(msg.text, msg.sources))}
                          className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 transition-colors"
                        >
                          ↓ Download
                        </button>
                      </div>
                    )}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2">
                        <button
                          onClick={() => setOpenSourcesIdx(prev => {
                            const next = new Set(prev)
                            next.has(i) ? next.delete(i) : next.add(i)
                            return next
                          })}
                          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors px-1 py-0.5 rounded group"
                        >
                          <svg
                            className={`w-3 h-3 transition-transform ${openSourcesIdx.has(i) ? 'rotate-90' : ''}`}
                            viewBox="0 0 20 20" fill="currentColor"
                          >
                            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                          </svg>
                          Sources used ({msg.sources.length})
                        </button>
                        {openSourcesIdx.has(i) && (
                          <div className="mt-1.5 space-y-1.5">
                            {msg.sources.map((src) => {
                              const label = src.source_type === 'contact'
                                ? (src.contact_name || src.contact_email || 'Contact')
                                : src.source_type === 'document'
                                  ? (src.subject || src.filename || 'Document')
                                  : src.subject || '(no subject)'

                              const relevance = src.relevance_pct ?? null
                              const badgeColor = relevance !== null && relevance >= 70
                                ? 'bg-green-100 text-green-700'
                                : relevance !== null && relevance >= 40
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-gray-100 text-gray-500'

                              const handleSourceClick = () => {
                                if (src.source_type === 'email' || !src.source_type) {
                                  setInput(`subject:"${src.subject || ''}" from:"${src.sender || ''}"`)
                                  setMode('smart-search')
                                  setNlQuery(`subject:"${src.subject || ''}" from:"${src.sender || ''}"`)
                                }
                              }

                              return (
                                <div
                                  key={src.email_id}
                                  onClick={handleSourceClick}
                                  className={`border rounded-lg px-3 py-2 transition-colors ${
                                    src.source_type === 'document'
                                      ? 'bg-amber-50 border-amber-200'
                                      : src.source_type === 'contact'
                                        ? 'bg-emerald-950/20 border-emerald-800/30'
                                        : 'bg-gray-50 border-gray-200 hover:border-accent hover:bg-white cursor-pointer'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      {src.source_type === 'document' ? (
                                        <>
                                          <p className="text-xs font-medium text-amber-800 truncate">{label}</p>
                                          <p className="text-xs text-amber-500 uppercase mt-0.5">{src.file_type} file</p>
                                        </>
                                      ) : src.source_type === 'contact' ? (
                                        <>
                                          <div className="flex items-center gap-1.5">
                                            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-900/40 text-emerald-300 border border-emerald-700/40 shrink-0">
                                              Contact
                                            </span>
                                            <p className="text-xs font-medium text-emerald-200 truncate">{label}</p>
                                          </div>
                                          {src.contact_email && (
                                            <p className="text-xs text-emerald-400/70 truncate mt-0.5">{src.contact_email}</p>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          <p className="text-xs font-medium text-gray-700 truncate">{label}</p>
                                          <p className="text-xs text-gray-400 truncate mt-0.5">{src.sender}</p>
                                          {src.date && (
                                            <p className="text-xs text-gray-300 mt-0.5">
                                              {new Date(src.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </p>
                                          )}
                                          {src.snippet && (
                                            <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{src.snippet}</p>
                                          )}
                                        </>
                                      )}
                                    </div>
                                    {relevance !== null && (
                                      <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badgeColor}`}>
                                        {relevance}%
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div className="border-t border-gray-200 px-4 py-3 flex flex-col gap-2 bg-white">
              <div className="flex items-center justify-between">
                <button
                  onClick={toggleHistory}
                  className="text-xs text-gray-400 hover:text-accent flex items-center gap-1 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  History
                </button>
                {messages.length > 0 && (
                  <button onClick={clearChat} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                    Clear chat
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submit()}
                  placeholder="Ask a question about your emails…"
                  disabled={loading}
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                />
                <button
                  onClick={() => submit()}
                  disabled={loading || !input.trim()}
                  className="px-4 py-2 bg-accent text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                  Ask
                </button>
              </div>
            </div>
          </>
        )}

        {/* Topic Search mode */}
        {mode === 'topic' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <p className="text-xs text-gray-400 mb-2">Find emails related to a topic using semantic search</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={topicQuery}
                  onChange={(e) => setTopicQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTopicSearch()}
                  placeholder="e.g. budget approval, project deadline, vendor contract…"
                  disabled={topicLoading}
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                />
                <button
                  onClick={handleTopicSearch}
                  disabled={topicLoading || !topicQuery.trim()}
                  className="px-4 py-2 bg-accent text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {topicLoading ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                    </svg>
                  )}
                  Search
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {topicLoading && (
                <div className="flex justify-center py-12">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!topicLoading && topicError && (
                <p className="text-sm text-gray-400 text-center py-8">{topicError}</p>
              )}
              {!topicLoading && topicResults === null && !topicError && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12">
                  <svg className="w-8 h-8 text-gray-200" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-gray-400">Type a topic to find related emails</p>
                  <p className="text-xs text-gray-300">Uses semantic similarity — finds conceptually related emails even without exact keyword matches</p>
                </div>
              )}
              {!topicLoading && topicResults !== null && topicResults.length > 0 && (
                <>
                  <p className="text-xs text-gray-400 pb-1">{topicResults.length} related email{topicResults.length !== 1 ? 's' : ''} found</p>
                  {topicResults.map((r) => (
                    <div key={r.email_id} className="border border-gray-200 rounded-xl px-4 py-3 bg-white hover:border-accent transition-colors">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.subject || '(no subject)'}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{r.sender}</p>
                      {r.date && (
                        <p className="text-xs text-gray-300 mt-0.5">
                          {new Date(r.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                      {r.text && (
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2"><Highlight text={r.text} query={topicQuery} /></p>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* Smart Search mode */}
        {mode === 'smart-search' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              {savedSearches.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Pinned</p>
                  <div className="flex flex-wrap gap-1.5">
                    {savedSearches.map(s => (
                      <div key={s.id} className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 group">
                        <button
                          onClick={() => { setNlQuery(s.query); handleNlSearchWith(s.query) }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          🔖 {s.name}
                        </button>
                        <button
                          onClick={() => removeSaved(s.id)}
                          className="text-gray-300 hover:text-red-400 text-[10px] leading-none ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400 mb-2">Describe what you're looking for in plain English</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nlQuery}
                  onChange={(e) => setNlQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleNlSearch()}
                  placeholder="e.g. show emails from last week about Q3 budget"
                  disabled={nlLoading}
                  className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                />
                <button
                  onClick={handleNlSearch}
                  disabled={nlLoading || !nlQuery.trim()}
                  className="px-4 py-2 bg-accent text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {nlLoading ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                    </svg>
                  )}
                  Search
                </button>
              </div>
              {nlResults !== null && Object.keys(nlFilters).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="text-[10px] text-gray-400 mr-1">Filters:</span>
                  {Object.entries(nlFilters).map(([k, v]) => (
                    <span key={k} className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                      {k.replace(/_/g, ' ')}: {String(v)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {nlLoading && (
                <div className="flex justify-center py-12">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!nlLoading && nlError && (
                <p className="text-sm text-gray-400 text-center py-8">{nlError}</p>
              )}
              {!nlLoading && nlResults === null && !nlError && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12">
                  <div className="text-3xl">✦</div>
                  <p className="text-sm text-gray-400">Describe what you're looking for</p>
                  <p className="text-xs text-gray-300">Claude extracts filters from your natural language query</p>
                </div>
              )}
              {!nlLoading && nlResults !== null && nlResults.length > 0 && (
                <>
                  <p className="text-xs text-gray-400 pb-1">{nlResults.length} email{nlResults.length !== 1 ? 's' : ''} found</p>
                  {nlResults.map((r) => (
                    <div key={r.email_id} className="border border-gray-200 rounded-xl px-4 py-3 bg-white hover:border-accent transition-colors">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.subject || '(no subject)'}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{r.sender}</p>
                      {r.date && (
                        <p className="text-xs text-gray-300 mt-0.5">
                          {new Date(r.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                      {r.preview && (
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2"><Highlight text={r.preview} query={nlQuery} /></p>
                      )}
                    </div>
                  ))}
                  {!showSaveInput ? (
                    <button
                      onClick={() => { setShowSaveInput(true); setSaveName('') }}
                      className="text-[10px] text-gray-400 hover:text-accent mt-2 flex items-center gap-1"
                    >
                      🔖 Save this search
                    </button>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        autoFocus
                        value={saveName}
                        onChange={e => setSaveName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveSearch(); if (e.key === 'Escape') setShowSaveInput(false) }}
                        placeholder="Search name…"
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 flex-1 max-w-[140px]"
                      />
                      <button onClick={saveSearch} className="text-xs text-white bg-accent px-2.5 py-1 rounded-lg hover:bg-blue-700">Save</button>
                      <button onClick={() => setShowSaveInput(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Documents mode */}
        {mode === 'docs' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              <p className="text-xs text-gray-400 mb-2">Ask questions about your indexed documents</p>
              <div className="flex gap-2">
                <input
                  value={docsQuery}
                  onChange={e => setDocsQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleDocsAsk()}
                  placeholder="What does our contract say about payment terms?"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  onClick={handleDocsAsk}
                  disabled={loadingDocs || !docsQuery.trim()}
                  className="text-sm bg-accent text-white rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  {loadingDocs ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : 'Ask'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {!loadingDocs && !docsAnswer && !docsError && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12">
                  <div className="text-3xl">📄</div>
                  <p className="text-sm text-gray-400">Ask anything about your documents</p>
                  <p className="text-xs text-gray-300">Only searches indexed document files — not emails</p>
                </div>
              )}
              {loadingDocs && (
                <div className="flex justify-center py-12">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!loadingDocs && docsError && (
                <p className="text-sm text-red-400 text-center py-8">{docsError}</p>
              )}
              {docsAnswer && (
                <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                  <p className="text-sm text-gray-800 leading-relaxed">{docsAnswer.answer}</p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(buildMarkdown(docsAnswer.answer, docsAnswer.sources)).catch(() => {})
                        setDocsAnswerCopied(true)
                        setTimeout(() => setDocsAnswerCopied(false), 1500)
                      }}
                      className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 transition-colors flex items-center gap-1"
                    >
                      {docsAnswerCopied ? '✓ Copied!' : '📋 Copy'}
                    </button>
                    <button
                      onClick={() => downloadMd(buildMarkdown(docsAnswer.answer, docsAnswer.sources))}
                      className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 transition-colors"
                    >
                      ↓ Download
                    </button>
                  </div>
                  {docsAnswer.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {docsAnswer.sources.map((s, i) => (
                        <span key={i} className="text-[10px] bg-white border border-blue-100 rounded-full px-2 py-0.5 text-blue-700">
                          {s.filename}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
