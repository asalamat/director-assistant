import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { StyleProfile } from '../types'

function formatDate(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z')
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function VoiceDraftPanel() {
  const [style, setStyle] = useState<StyleProfile | null>(null)
  const [sampleCount, setSampleCount] = useState(0)
  const [computedAt, setComputedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = () => {
    api.getStyleProfile()
      .then(r => { setStyle(r.style); setSampleCount(r.sample_count); setComputedAt(r.computed_at) })
      .catch(() => {})
  }

  useEffect(refresh, [])

  const learn = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const r = await api.learnWritingStyle(50)
      setStyle(r.style)
      setSampleCount(r.samples_used)
      setComputedAt(new Date().toISOString())
    } catch (e: any) {
      setError(e?.message || 'Could not learn your style.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={`border rounded-xl bg-white p-4 space-y-3 ${style ? 'border-green-300' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Voice-Matched Drafts</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Learn how you write from your sent mail so AI drafts sound like you.
          </p>
        </div>
        <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${style ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {style ? 'On' : 'Off'}
        </span>
      </div>

      {style ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 space-y-1.5">
          <p className="text-xs font-medium text-emerald-800">
            ✓ Style learned from {sampleCount} sent email{sampleCount === 1 ? '' : 's'}
          </p>
          {style.summary && <p className="text-xs text-gray-600">{style.summary}</p>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {style.tone && <span className="text-[10px] px-2 py-0.5 bg-white border border-emerald-200 rounded-full text-emerald-700">{style.tone}</span>}
            {style.formality && <span className="text-[10px] px-2 py-0.5 bg-white border border-emerald-200 rounded-full text-emerald-700">{style.formality}</span>}
            {style.closing_style && <span className="text-[10px] px-2 py-0.5 bg-white border border-emerald-200 rounded-full text-emerald-700">signs: {style.closing_style}</span>}
          </div>
          {computedAt && (
            <p className="text-[10px] text-gray-400 pt-0.5">Last learned: {formatDate(computedAt)}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500 italic">No style learned yet.</p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={learn}
        disabled={loading}
        className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
      >
        {loading
          ? <><span className="animate-spin inline-block">⟳</span> Analyzing your sent mail…</>
          : style ? 'Re-learn my style' : 'Learn my style'}
      </button>
    </section>
  )
}
