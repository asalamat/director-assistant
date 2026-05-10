import { useState } from 'react'
import type { AIRecommendation } from '../types'

interface Props {
  rec: AIRecommendation | null
  loading: boolean
  error: string
}

const URGENCY_STYLES: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

const TONE_ICON: Record<string, string> = {
  formal: '🎩',
  casual: '💬',
  urgent: '⚡',
  friendly: '😊',
  neutral: '📄',
}

export function AIPanel({ rec, loading, error }: Props) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const copy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  if (loading) {
    return (
      <div className="w-80 flex-shrink-0 bg-gray-50 border-l border-gray-200 flex flex-col items-center justify-center gap-3 p-6">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Analyzing email…</p>
        <p className="text-xs text-gray-400 text-center">
          RAG search + Claude re-ranking + generating replies
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-80 flex-shrink-0 bg-gray-50 border-l border-gray-200 flex items-center justify-center p-6">
        <p className="text-sm text-red-500 text-center">{error}</p>
      </div>
    )
  }

  if (!rec) {
    return (
      <div className="w-80 flex-shrink-0 bg-gray-50 border-l border-gray-200 flex flex-col items-center justify-center gap-2 p-6">
        <div className="text-3xl">✦</div>
        <p className="text-sm text-gray-400 text-center">
          Click "AI Analysis" to get reply suggestions
        </p>
      </div>
    )
  }

  return (
    <div className="w-80 flex-shrink-0 bg-gray-50 border-l border-gray-200 flex flex-col overflow-y-auto">
      {/* Urgency + tone badges */}
      <div className="px-4 pt-4 flex gap-2 flex-wrap">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${URGENCY_STYLES[rec.urgency] ?? 'bg-gray-100 text-gray-600'}`}>
          {rec.urgency.charAt(0).toUpperCase() + rec.urgency.slice(1)} urgency
        </span>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
          {TONE_ICON[rec.tone] ?? '📄'} {rec.tone}
        </span>
      </div>

      {/* Analysis */}
      {rec.analysis && (
        <div className="px-4 pt-3">
          <p className="text-xs text-gray-600 leading-relaxed">{rec.analysis}</p>
        </div>
      )}

      {/* Key Points */}
      {rec.key_points.length > 0 && (
        <Section title="Key Points">
          <ul className="space-y-1">
            {rec.key_points.map((p, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-gray-300 mt-0.5">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Action Items */}
      {rec.action_items.length > 0 && (
        <Section title="Action Items">
          <ul className="space-y-1">
            {rec.action_items.map((a, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-accent mt-0.5">☐</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Suggested Replies */}
      {rec.suggested_replies.length > 0 && (
        <Section title="Suggested Replies">
          <div className="space-y-2">
            {rec.suggested_replies.map((reply, i) => {
              const labels = ['Brief', 'Professional', 'Detailed']
              return (
                <div key={i} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-500">{labels[i] ?? `Option ${i + 1}`}</span>
                    <button
                      onClick={() => copy(reply, i)}
                      className="text-xs text-accent hover:text-blue-700 transition-colors"
                    >
                      {copiedIdx === i ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{reply}</p>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Similar Emails */}
      {rec.similar_emails.length > 0 && (
        <Section title="Similar Past Emails">
          <div className="space-y-2">
            {rec.similar_emails.map((e) => (
              <div key={e.id} className="bg-white border border-gray-200 rounded-lg p-2.5">
                <p className="text-xs font-medium text-gray-800 truncate">{e.subject}</p>
                <p className="text-xs text-gray-400 truncate">{e.sender}</p>
                {e.date && (
                  <p className="text-xs text-gray-300 mt-0.5">
                    {new Date(e.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="h-4" />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  )
}
