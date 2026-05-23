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

const SUGGESTIONS = [
  'Who sent me the most emails this month?',
  'Are there any unresolved action items?',
  'What were the last emails about the Q3 report?',
]

export function AskPanel({ initialQuery, onClear }: { initialQuery?: string; onClear?: () => void } = {}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [history, setHistory] = useState<HistoryMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyList, setHistoryList] = useState<AskHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastInitial = useRef<string | undefined>(undefined)

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
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* History sidebar */}
      {showHistory && (
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

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Messages */}
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
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs text-gray-400 px-1">Sources</p>
                    {msg.sources.map((src) => (
                      <div key={src.email_id} className={`border rounded-lg px-3 py-1.5 ${src.source_type === 'document' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
                        {src.source_type === 'document' ? (
                          <>
                            <p className="text-xs font-medium text-amber-800 truncate">{src.filename}</p>
                            <p className="text-xs text-amber-500 uppercase">{src.file_type} file</p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs font-medium text-gray-700 truncate">{src.subject}</p>
                            <p className="text-xs text-gray-400 truncate">{src.sender}</p>
                            {src.date && (
                              <p className="text-xs text-gray-300">
                                {new Date(src.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    ))}
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
      </div>
    </div>
  )
}
