import { useState, useRef, useEffect } from 'react'

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
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastInitial = useRef<string | undefined>(undefined)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = async (overrideQ?: string) => {
    const q = (overrideQ ?? input).trim()
    if (!q || loading) return

    setMessages(prev => [...prev, { role: 'user', text: q }])
    setInput('')
    setLoading(true)

    // Placeholder for streaming assistant response
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

    // Finalise — remove streaming cursor, attach sources
    setMessages(prev => {
      const msgs = [...prev]
      msgs[msgs.length - 1] = { role: 'assistant', text: fullText, sources, streaming: false }
      return msgs
    })

    // Track conversation history for follow-up context
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
                  <span className="inline-block w-1.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse rounded-sm align-middle" />
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
        {messages.length > 0 && (
          <button onClick={clearChat} className="self-end text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Clear chat
          </button>
        )}
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
  )
}
