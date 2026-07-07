import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { ToneReport, RewriteToneName } from '../types'

interface Props {
  text: string
  onRewrite: (newText: string) => void
}

const REWRITE_CHIPS: { tone: RewriteToneName; label: string }[] = [
  { tone: 'warmer', label: 'Warmer ✨' },
  { tone: 'more_direct', label: 'More Direct →' },
  { tone: 'more_formal', label: 'More Formal' },
  { tone: 'shorter', label: 'Shorter' },
]

const LABEL_STYLE: Record<ToneReport['label'], { dot: string; text: string }> = {
  good: { dot: 'bg-green-500', text: 'text-green-700' },
  warning: { dot: 'bg-yellow-500', text: 'text-yellow-700' },
  issue: { dot: 'bg-red-500', text: 'text-red-700' },
}

export function ToneCoach({ text, onRewrite }: Props) {
  const [report, setReport] = useState<ToneReport | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [rewriting, setRewriting] = useState<RewriteToneName | null>(null)
  const lastAnalyzed = useRef('')

  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed.length < 15) {
      setReport(null)
      return
    }
    const handle = setTimeout(async () => {
      if (trimmed === lastAnalyzed.current) return
      lastAnalyzed.current = trimmed
      setAnalyzing(true)
      try {
        const r = await api.analyzeTone(trimmed.slice(0, 4000))
        setReport(r)
      } catch {
        setReport(null)
      } finally {
        setAnalyzing(false)
      }
    }, 1500)
    return () => clearTimeout(handle)
  }, [text])

  const handleRewrite = async (tone: RewriteToneName) => {
    if (!text.trim() || rewriting) return
    setRewriting(tone)
    try {
      const { rewrites } = await api.getRewriteOptions(text.slice(0, 4000), [tone])
      const result = rewrites[0]?.text
      if (result) {
        onRewrite(result)
        lastAnalyzed.current = ''
      }
    } catch {
      /* ignore — leave body unchanged */
    } finally {
      setRewriting(null)
    }
  }

  if (text.trim().length < 15) return null

  const style = report ? LABEL_STYLE[report.label] : null

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-2 text-xs border-t border-gray-100 bg-gray-50">
      {analyzing && !report ? (
        <span className="text-gray-400">Analyzing tone…</span>
      ) : report && style ? (
        <span className={`inline-flex items-center gap-1.5 font-medium ${style.text}`}>
          <span className={`w-2 h-2 rounded-full ${style.dot}`} />
          {report.tone}
        </span>
      ) : null}

      {report?.issues.map((issue, i) => (
        <span
          key={i}
          className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100"
        >
          {issue}
        </span>
      ))}

      <span className="text-gray-300">·</span>

      {REWRITE_CHIPS.map(({ tone, label }) => (
        <button
          key={tone}
          onClick={() => handleRewrite(tone)}
          disabled={rewriting !== null}
          className="px-2 py-0.5 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-accent hover:text-accent disabled:opacity-50 transition-colors"
        >
          {rewriting === tone ? 'Rewriting…' : label}
        </button>
      ))}
    </div>
  )
}
