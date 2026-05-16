import { useState, useRef, useEffect } from 'react'
import { api } from '../api/client'

interface Source {
  email_id: string
  subject: string
  sender: string
  date: string
}

interface Message {
  role: 'user' | 'assistant'
  text: string
  sources?: Source[]
}

export function AskPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = async () => {
    const q = input.trim()
    if (!q || loading) return

    setMessages(prev => [...prev, { role: 'user', text: q }])
    setInput('')
    setLoading(true)

    try {
      const res = await api.askDB(q)
      setMessages(prev => [...prev, { role: 'assistant', text: res.answer, sources: res.sources }])
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
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
              Questions like "Who emailed me about the budget?", "What's the status of the
              project X proposal?", "Show me recent emails from Alice"
            </p>
            <div className="grid grid-cols-1 gap-2 mt-2 w-full max-w-sm">
              {[
                'Who sent me the most emails this month?',
                'Are there any unresolved action items?',
                'What were the last emails about the Q3 report?',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs text-left px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-2' : ''}`}>
              <div
                className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}
              >
                {msg.text}
              </div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-gray-400 px-1">Sources</p>
                  {msg.sources.map((src) => (
                    <div
                      key={src.email_id}
                      className="bg-white border border-gray-200 rounded-lg px-3 py-1.5"
                    >
                      <p className="text-xs font-medium text-gray-700 truncate">{src.subject}</p>
                      <p className="text-xs text-gray-400 truncate">{src.sender}</p>
                      {src.date && (
                        <p className="text-xs text-gray-300">
                          {new Date(src.date).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-200 px-4 py-3 flex gap-2 bg-white">
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
          onClick={submit}
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
  )
}
