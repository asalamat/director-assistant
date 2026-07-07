import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { LinkedInVoiceProfile } from '../../types'

function learnedAgo(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso + 'Z')
  if (isNaN(d.getTime())) return ''
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const TRAITS: { key: keyof LinkedInVoiceProfile; label: string }[] = [
  { key: 'hook_style', label: 'Hook style' },
  { key: 'avg_length', label: 'Avg length' },
  { key: 'emoji_usage', label: 'Emoji usage' },
  { key: 'cta_style', label: 'CTA style' },
  { key: 'formality', label: 'Formality' },
]

export function LinkedInVoicePanel() {
  const [profile, setProfile] = useState<LinkedInVoiceProfile | null>(null)
  const [computedAt, setComputedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [learning, setLearning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getLinkedInVoiceProfile()
      .then(r => { setProfile(r.profile); setComputedAt(r.computed_at) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const learn = async () => {
    setLearning(true); setError('')
    try {
      const r = await api.learnLinkedInVoice()
      if (r.error) { setError(r.error); return }
      setProfile(r.profile)
      setComputedAt(new Date().toISOString())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLearning(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">🎙️</span>
        <h3 className="text-sm font-semibold text-gray-900">LinkedIn Voice Profile</h3>
        {profile && computedAt && (
          <span className="ml-auto text-[11px] text-gray-400">learned {learnedAgo(computedAt)}</span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
      ) : profile ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {TRAITS.map(({ key, label }) => {
              const val = profile[key]
              if (!val || (typeof val === 'string' && !val.trim())) return null
              return (
                <div key={key} className="bg-gray-50 rounded-lg px-2.5 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
                  <p className="text-xs text-gray-700 leading-snug">{String(val)}</p>
                </div>
              )
            })}
          </div>
          {profile.recurring_themes?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {profile.recurring_themes.map((t, i) => (
                <span key={i} className="px-2 py-0.5 bg-blue-50 text-accent rounded-full text-[10px] font-medium">{t}</span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-500">
          Not learned yet. Analyze your past LinkedIn posts to capture your writing style and apply it to new drafts.
        </p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button onClick={learn} disabled={learning}
        className="text-xs bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-50 transition">
        {learning ? 'Analyzing posts…' : profile ? '↻ Re-learn My Voice' : '✨ Learn My Voice'}
      </button>
    </div>
  )
}
