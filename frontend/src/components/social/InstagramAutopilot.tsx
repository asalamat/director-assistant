import { useEffect, useState } from 'react'
import { api } from '../../api/client'

interface AutopilotConfig {
  id: number
  topics: string[]
  tone: string
  hashtag_count: number
  content_type: string
  interval_days: number
  post_time: string
  enabled: number
  topic_index: number
  last_post_at: string | null
  next_post_at: string | null
}

const TONES = ['Inspiring', 'Educational', 'Behind-the-scenes', 'Promotional', 'Personal']
const CONTENT_TYPES = [
  { value: 'image+text', label: '🖼+📄 Image & text' },
  { value: 'text',       label: '📄 Text only' },
  { value: 'image',      label: '🖼 Image only' },
]

const gradient = 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600'

function nextPostFromNow(intervalDays: number, postTime: string): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const [h, m] = (postTime || '09:00').split(':')
  d.setHours(parseInt(h), parseInt(m), 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export function InstagramAutopilot() {
  const [config, setConfig] = useState<AutopilotConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [topicsText, setTopicsText] = useState('')
  const [tone, setTone] = useState('Inspiring')
  const [hashtagCount, setHashtagCount] = useState(15)
  const [contentType, setContentType] = useState('image+text')
  const [intervalDays, setIntervalDays] = useState(3)
  const [postTime, setPostTime] = useState('09:00')
  const [firstPostAt, setFirstPostAt] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(api as any).getInstagramAutopilot()
      .then((r: any) => {
        if (cancelled) return
        setConfig(r.config)
        if (r.config) populateForm(r.config)
        else setEditing(true)
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function populateForm(c: AutopilotConfig) {
    setTopicsText((c.topics || []).join('\n'))
    setTone(c.tone || 'Inspiring')
    setHashtagCount(c.hashtag_count || 15)
    setContentType(c.content_type || 'image+text')
    setIntervalDays(c.interval_days || 3)
    setPostTime(c.post_time || '09:00')
    setFirstPostAt(c.next_post_at || '')
  }

  const topics = topicsText.split('\n').map(t => t.trim()).filter(Boolean)

  const handleSave = async (enabled: boolean) => {
    if (topics.length === 0) { setError('Add at least one topic'); return }
    setSaving(true); setError('')
    try {
      const next = firstPostAt || nextPostFromNow(intervalDays, postTime)
      await (api as any).saveInstagramAutopilot({
        topics, tone, hashtag_count: hashtagCount,
        content_type: contentType, interval_days: intervalDays,
        post_time: postTime, enabled,
        next_post_at: next,
        topic_index: config?.topic_index ?? 0,
      })
      const r = await (api as any).getInstagramAutopilot()
      setConfig(r.config)
      setEditing(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  const handleToggle = async () => {
    if (!config) return
    setSaving(true)
    try {
      await (api as any).saveInstagramAutopilot({
        topics: config.topics, tone: config.tone,
        hashtag_count: config.hashtag_count,
        content_type: config.content_type,
        interval_days: config.interval_days,
        post_time: config.post_time,
        enabled: !config.enabled,
        next_post_at: config.next_post_at,
        topic_index: config.topic_index,
      })
      setConfig(prev => prev ? { ...prev, enabled: prev.enabled ? 0 : 1 } : prev)
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!confirm('Remove Instagram Autopilot?')) return
    await (api as any).deleteInstagramAutopilot()
    setConfig(null); setEditing(true)
    setTopicsText(''); setTone('Inspiring'); setHashtagCount(15)
    setContentType('image+text'); setIntervalDays(3); setPostTime('09:00'); setFirstPostAt('')
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Instagram Autopilot</h2>
          <p className="text-xs text-gray-500 mt-0.5">Auto-generate and publish Instagram posts on a recurring schedule.</p>
        </div>
        {config && !editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggle}
              disabled={saving}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.enabled ? gradient : 'bg-gray-300'} disabled:opacity-50`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-gray-500">{config.enabled ? 'Active' : 'Paused'}</span>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {/* Status panel */}
      {config && !editing && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Topics</p>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">{config.topics.length}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Interval</p>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">Every {config.interval_days}d</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Posted</p>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">{config.topic_index} / {config.topics.length}</p>
            </div>
          </div>

          {config.next_post_at && (
            <div className={`rounded-xl px-4 py-3 border ${config.enabled ? 'bg-pink-50 border-pink-100' : 'bg-gray-50 border-gray-100'}`}>
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Next post</p>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {config.topics[config.topic_index % config.topics.length] || '—'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(config.next_post_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                {!config.enabled && ' · Paused'}
                {' · '}Tone: {config.tone}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Topic queue</p>
            <div className="space-y-1.5">
              {config.topics.map((t, i) => {
                const current = i === config.topic_index % config.topics.length
                return (
                  <div key={i} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm ${
                    current ? 'border-pink-400 bg-pink-50 text-pink-700 font-medium' : 'border-gray-100 text-gray-700'
                  }`}>
                    <span className="text-[10px] w-5 text-center font-mono text-gray-400">{i + 1}</span>
                    <span className="flex-1 truncate">{t}</span>
                    {current && <span className="text-[10px] text-pink-500 font-medium">Next ↑</span>}
                  </div>
                )
              })}
            </div>
          </div>

          {config.last_post_at && (
            <p className="text-xs text-gray-400">
              Last posted: {new Date(config.last_post_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => { setEditing(true); populateForm(config) }}
              className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
              Edit
            </button>
            <button onClick={handleDelete}
              className="px-4 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition ml-auto">
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Setup / Edit form */}
      {editing && (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Topics <span className="text-gray-400 font-normal">(one per line)</span>
            </label>
            <textarea
              rows={6}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-pink-400 resize-none placeholder-gray-300"
              placeholder={"Morning routine tips\nBusiness mindset\nBehind the scenes\nProduct spotlight"}
              value={topicsText}
              onChange={e => setTopicsText(e.target.value)}
            />
            <p className="text-[11px] text-gray-400 mt-1">{topics.length} topic{topics.length !== 1 ? 's' : ''} · cycles repeatedly</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Tone</label>
            <div className="flex flex-wrap gap-2">
              {TONES.map(t => (
                <button key={t} onClick={() => setTone(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    tone === t ? `${gradient} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>{t}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-gray-700">Hashtags per post</label>
              <span className="text-xs font-semibold text-purple-600">{hashtagCount}</span>
            </div>
            <input type="range" min={5} max={30} value={hashtagCount}
              onChange={e => setHashtagCount(Number(e.target.value))}
              className="w-full accent-purple-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Content type</label>
            <div className="flex gap-2">
              {CONTENT_TYPES.map(ct => (
                <button key={ct.value} onClick={() => setContentType(ct.value)}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition ${
                    contentType === ct.value ? 'border-pink-400 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>{ct.label}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Repeat every</label>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={90}
                  className="w-20 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-pink-400"
                  value={intervalDays}
                  onChange={e => setIntervalDays(Math.max(1, parseInt(e.target.value) || 1))} />
                <span className="text-sm text-gray-500">days</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">At time</label>
              <input type="time"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-pink-400"
                value={postTime} onChange={e => setPostTime(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              First post at <span className="text-gray-400 font-normal">(optional — defaults to tomorrow)</span>
            </label>
            <input type="datetime-local"
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-pink-400"
              value={firstPostAt} onChange={e => setFirstPostAt(e.target.value)} />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => handleSave(true)} disabled={saving || topics.length === 0}
              className={`flex items-center gap-2 px-5 py-2.5 ${gradient} text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition`}>
              {saving ? '…' : '📸'} {config ? 'Save changes' : 'Enable Autopilot'}
            </button>
            {config && (
              <button onClick={() => setEditing(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
