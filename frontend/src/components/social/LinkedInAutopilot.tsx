import { useEffect, useState } from 'react'
import { api } from '../../api/client'

interface AutopilotConfig {
  id: number
  topics: string[]
  template_id: string | null
  content_type: string
  interval_days: number
  post_time: string
  enabled: number
  topic_index: number
  last_post_at: string | null
  next_post_at: string | null
  require_review: number
  fixed_hashtags: string[]
}

interface ReviewPost {
  id: string
  topic: string
  post_text: string
  image_url: string | null
  content_type: string
  created_at: string
}

interface Template {
  id: string
  name: string
  prompt: string
  builtin: number
}

const CONTENT_TYPES = [
  { value: 'image+text', label: '🖼+📄 Image & text' },
  { value: 'article',    label: '📄 Text only' },
  { value: 'image',      label: '🖼 Image only' },
]

function nextPostFromNow(intervalDays: number, postTime: string): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const [h, m] = (postTime || '09:00').split(':')
  d.setHours(parseInt(h), parseInt(m), 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export function LinkedInAutopilot() {
  const [config, setConfig] = useState<AutopilotConfig | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [topicsText, setTopicsText] = useState('')
  const [templateId, setTemplateId] = useState<string>('')
  const [contentType, setContentType] = useState('image+text')
  const [intervalDays, setIntervalDays] = useState(7)
  const [postTime, setPostTime] = useState('09:00')
  const [firstPostAt, setFirstPostAt] = useState('')
  const [requireReview, setRequireReview] = useState(false)
  const [fixedHashtagsText, setFixedHashtagsText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')

  // Review queue
  const [reviewPosts, setReviewPosts] = useState<ReviewPost[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [editingReview, setEditingReview] = useState<{id: string, text: string} | null>(null)
  const [reviewAction, setReviewAction] = useState<{[id: string]: string}>({})

  // Engagement stats
  const [stats, setStats] = useState<{[postId: string]: {likes: number, comments: number, reposts: number}}>({})
  const [statsLoading, setStatsLoading] = useState<{[postId: string]: boolean}>({})

  useEffect(() => {
    let cancelled = false
    Promise.all([
      (api as any).getLinkedInAutopilot(),
      api.getLinkedInTemplates(),
    ]).then(([ap, tmpl]) => {
      if (cancelled) return
      setConfig(ap.config)
      setTemplates(tmpl.templates || [])
      if (ap.config) populateForm(ap.config)
      else setEditing(true)
    }).catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function populateForm(c: AutopilotConfig) {
    setTopicsText((c.topics || []).join('\n'))
    setTemplateId(c.template_id || '')
    setContentType(c.content_type || 'image+text')
    setIntervalDays(c.interval_days || 7)
    setPostTime(c.post_time || '09:00')
    setFirstPostAt(c.next_post_at || '')
    setRequireReview(!!c.require_review)
    setFixedHashtagsText((c.fixed_hashtags || []).join(' '))
  }

  const loadReviewQueue = async () => {
    setReviewLoading(true)
    try {
      const res = await fetch('/api/social/linkedin/autopilot/review-queue')
      const data = await res.json()
      setReviewPosts(data.posts || [])
    } finally {
      setReviewLoading(false)
    }
  }

  useEffect(() => { if (config?.require_review) loadReviewQueue() }, [config?.require_review])

  const handleApprove = async (postId: string) => {
    setReviewAction(p => ({ ...p, [postId]: 'approving' }))
    const res = await fetch(`/api/social/linkedin/autopilot/review/${postId}/approve`, { method: 'POST' })
    const data = await res.json()
    if (data.error) { setError(data.error); setReviewAction(p => ({ ...p, [postId]: '' })); return }
    setReviewPosts(prev => prev.filter(p => p.id !== postId))
    setReviewAction(p => ({ ...p, [postId]: '' }))
  }

  const handleEditApprove = async (postId: string) => {
    if (!editingReview || editingReview.id !== postId) return
    setReviewAction(p => ({ ...p, [postId]: 'publishing' }))
    const res = await fetch(`/api/social/linkedin/autopilot/review/${postId}/edit-approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_text: editingReview.text }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setReviewAction(p => ({ ...p, [postId]: '' })); return }
    setReviewPosts(prev => prev.filter(p => p.id !== postId))
    setEditingReview(null)
    setReviewAction(p => ({ ...p, [postId]: '' }))
  }

  const handleReject = async (postId: string) => {
    setReviewAction(p => ({ ...p, [postId]: 'rejecting' }))
    await fetch(`/api/social/linkedin/autopilot/review/${postId}/reject`, { method: 'POST' })
    setReviewPosts(prev => prev.filter(p => p.id !== postId))
    setReviewAction(p => ({ ...p, [postId]: '' }))
  }

  const fetchStats = async (postId: string) => {
    setStatsLoading(p => ({ ...p, [postId]: true }))
    try {
      const res = await fetch(`/api/social/linkedin/history/${postId}/stats`)
      const data = await res.json()
      if (!data.error) setStats(p => ({ ...p, [postId]: data }))
    } finally {
      setStatsLoading(p => ({ ...p, [postId]: false }))
    }
  }

  const topics = topicsText.split('\n').map(t => t.trim()).filter(Boolean)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setExtracting(true); setExtractError('')
    try {
      const r = await (api as any).extractTopicsFromFile(file)
      if (r.error) { setExtractError(r.error); return }
      const newTopics = (r.topics as string[]).join('\n')
      setTopicsText(prev => prev ? prev + '\n' + newTopics : newTopics)
    } catch (e) {
      setExtractError((e as Error).message)
    } finally {
      setExtracting(false)
      e.target.value = ''
    }
  }

  const handleSave = async (enabled: boolean) => {
    if (topics.length === 0) { setError('Add at least one topic'); return }
    setSaving(true); setError('')
    try {
      const next = firstPostAt || nextPostFromNow(intervalDays, postTime)
      const fixedTags = fixedHashtagsText.split(/[\s,]+/).map(t => t.trim().replace(/^#/, '')).filter(Boolean)
      await (api as any).saveLinkedInAutopilot({
        topics,
        template_id: templateId || null,
        content_type: contentType,
        interval_days: intervalDays,
        post_time: postTime,
        enabled,
        next_post_at: next,
        topic_index: config?.topic_index ?? 0,
        require_review: requireReview,
        fixed_hashtags: fixedTags,
      })
      const ap = await (api as any).getLinkedInAutopilot()
      setConfig(ap.config)
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    if (!config) return
    setSaving(true)
    try {
      await (api as any).saveLinkedInAutopilot({
        topics: config.topics,
        template_id: config.template_id,
        content_type: config.content_type,
        interval_days: config.interval_days,
        post_time: config.post_time,
        enabled: !config.enabled,
        next_post_at: config.next_post_at,
        topic_index: config.topic_index,
      })
      setConfig(prev => prev ? { ...prev, enabled: prev.enabled ? 0 : 1 } : prev)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Remove autopilot configuration?')) return
    await (api as any).deleteLinkedInAutopilot()
    setConfig(null)
    setEditing(true)
    setTopicsText(''); setTemplateId(''); setContentType('image+text')
    setIntervalDays(7); setPostTime('09:00'); setFirstPostAt('')
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">LinkedIn Autopilot</h2>
          <p className="text-xs text-gray-500 mt-0.5">Auto-generate and publish posts on a recurring schedule.</p>
        </div>
        {config && !editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggle}
              disabled={saving}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.enabled ? 'bg-accent' : 'bg-gray-300'} disabled:opacity-50`}
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
          {/* Stats row */}
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

          {/* Next post */}
          {config.next_post_at && (
            <div className={`rounded-xl px-4 py-3 border ${config.enabled ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Next post</p>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {config.topics[config.topic_index % config.topics.length] || '—'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(config.next_post_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                {!config.enabled && ' · Paused'}
              </p>
            </div>
          )}

          {/* Topic queue */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Topic queue</p>
            <div className="space-y-1.5">
              {config.topics.map((t, i) => {
                const current = i === config.topic_index % config.topics.length
                const posted = i < config.topic_index % config.topics.length ||
                               (config.topic_index >= config.topics.length && true)
                return (
                  <div key={i} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm ${
                    current ? 'border-accent bg-blue-50 text-accent font-medium' :
                    'border-gray-100 text-gray-700'
                  }`}>
                    <span className="text-[10px] w-5 text-center font-mono text-gray-400">{i + 1}</span>
                    <span className="flex-1 truncate">{t}</span>
                    {current && <span className="text-[10px] text-accent font-medium">Next ↑</span>}
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

          {/* Review queue */}
          {config.require_review && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-500">Review queue</p>
                <button onClick={loadReviewQueue} className="text-[11px] text-gray-400 hover:text-accent">↺ Refresh</button>
              </div>
              {reviewLoading ? (
                <p className="text-xs text-gray-400">Loading…</p>
              ) : reviewPosts.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No posts awaiting review.</p>
              ) : reviewPosts.map(post => (
                <div key={post.id} className="border border-amber-200 bg-amber-50 rounded-xl p-3 mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-amber-800 truncate flex-1">{post.topic}</span>
                    <span className="text-[10px] text-gray-400 ml-2 flex-shrink-0">
                      {new Date(post.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  {post.image_url && (
                    <img src={post.image_url} alt="" className="w-full h-24 object-cover rounded-lg mb-2" />
                  )}
                  {editingReview?.id === post.id ? (
                    <textarea
                      value={editingReview.text}
                      onChange={e => setEditingReview({ id: post.id, text: e.target.value })}
                      rows={5}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 mb-2"
                    />
                  ) : (
                    <p className="text-xs text-gray-700 whitespace-pre-line line-clamp-4 mb-2">{post.post_text}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {editingReview?.id === post.id ? (
                      <>
                        <button
                          onClick={() => handleEditApprove(post.id)}
                          disabled={!!reviewAction[post.id]}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-50"
                        >{reviewAction[post.id] === 'publishing' ? '…' : '✓ Publish edited'}</button>
                        <button onClick={() => setEditingReview(null)} className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleApprove(post.id)}
                          disabled={!!reviewAction[post.id]}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                        >{reviewAction[post.id] === 'approving' ? '…' : '✓ Approve & Publish'}</button>
                        <button
                          onClick={() => setEditingReview({ id: post.id, text: post.post_text })}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                        >✏️ Edit</button>
                        <button
                          onClick={() => handleReject(post.id)}
                          disabled={!!reviewAction[post.id]}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50"
                        >{reviewAction[post.id] === 'rejecting' ? '…' : '✕ Reject'}</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setEditing(true); populateForm(config) }}
              className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition ml-auto"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Setup / Edit form */}
      {editing && (
        <div className="space-y-5">
          {/* Topics */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Topics <span className="text-gray-400 font-normal">(one per line)</span>
            </label>
            <textarea
              rows={6}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none placeholder-gray-300"
              placeholder={"AI in healthcare\nLeadership lessons\nRemote work best practices\nThe future of SaaS"}
              value={topicsText}
              onChange={e => setTopicsText(e.target.value)}
            />
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[11px] text-gray-400">{topics.length} topic{topics.length !== 1 ? 's' : ''} · cycles repeatedly</p>
              <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition ${
                extracting ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-accent/40 text-accent hover:bg-blue-50'
              }`}>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.rtf"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={extracting}
                />
                {extracting ? '⏳ Reading file…' : '📄 Upload resume / file'}
              </label>
            </div>
            {extractError && <p className="text-xs text-red-500 mt-1">{extractError}</p>}
          </div>

          {/* Template */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Prompt template</label>
            <select
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent bg-white"
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
            >
              <option value="">— Default (no template) —</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Content type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Content type</label>
            <div className="flex gap-2">
              {CONTENT_TYPES.map(ct => (
                <button
                  key={ct.value}
                  onClick={() => setContentType(ct.value)}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition ${
                    contentType === ct.value ? 'border-accent bg-blue-50 text-accent' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Repeat every</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={90}
                  className="w-20 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                  value={intervalDays}
                  onChange={e => setIntervalDays(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <span className="text-sm text-gray-500">days</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">At time</label>
              <input
                type="time"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                value={postTime}
                onChange={e => setPostTime(e.target.value)}
              />
            </div>
          </div>

          {/* First post */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              First post at <span className="text-gray-400 font-normal">(optional — defaults to tomorrow at the set time)</span>
            </label>
            <input
              type="datetime-local"
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              value={firstPostAt}
              onChange={e => setFirstPostAt(e.target.value)}
            />
          </div>

          {/* Fixed hashtags */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Fixed hashtags <span className="text-gray-400 font-normal">(always included — space or comma separated)</span>
            </label>
            <input
              type="text"
              placeholder="#leadership #ai #innovation"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              value={fixedHashtagsText}
              onChange={e => setFixedHashtagsText(e.target.value)}
            />
          </div>

          {/* Review toggle */}
          <label className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 cursor-pointer">
            <div>
              <p className="text-sm font-medium text-gray-700">Require review before publishing</p>
              <p className="text-xs text-gray-400 mt-0.5">Posts go to a review queue — you approve, edit, or reject each one before it goes live</p>
            </div>
            <div
              onClick={() => setRequireReview(v => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${requireReview ? 'bg-accent' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${requireReview ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => handleSave(true)}
              disabled={saving || topics.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {saving ? '…' : '🤖'} {config ? 'Save changes' : 'Enable Autopilot'}
            </button>
            {config && (
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
