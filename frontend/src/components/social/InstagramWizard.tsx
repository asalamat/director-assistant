import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import { PostScoreWidget } from './PostScoreWidget'
import type { PostScore } from '../../types'

const BASE = '/api/instagram'
const post = async (path: string, body: object) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

const STEPS = ['Template', 'Your Post', 'Image', 'Preview']
const TONES = ['Inspiring', 'Educational', 'Behind-the-scenes', 'Promotional', 'Personal', 'Casual']

interface IgTemplate { id: string; name: string; icon: string; tone: string; prompt: string; builtin: number }

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((label, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <div key={n} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
              done || active ? 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white' : 'bg-gray-100 text-gray-400'
            }`}>
              {done ? '✓' : n}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-6 rounded-full ${n < current ? 'bg-purple-500' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
      <span className="ml-2 text-xs text-gray-400">{STEPS[current - 1]}</span>
    </div>
  )
}

function Spinner() {
  return <span className="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${value ? 'bg-gradient-to-r from-pink-500 to-purple-600' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
    </button>
  )
}

const NO_TEMPLATE: IgTemplate = { id: '__none__', name: 'No Template', icon: '✏️', tone: 'Inspiring', prompt: '', builtin: 1 }

export function InstagramWizard({ onViewHistory }: { onViewHistory: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Template
  const [templates, setTemplates] = useState<IgTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<IgTemplate>(NO_TEMPLATE)

  // Post content
  const [topic, setTopic] = useState('')
  const [tone, setTone] = useState('Inspiring')
  const [hashtagCount, setHashtagCount] = useState(15)
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [usedTemplate, setUsedTemplate] = useState<IgTemplate | null>(null)
  const [score, setScore] = useState<PostScore | null>(null)
  const [scoring, setScoring] = useState(false)

  // Image
  const [imageUrl, setImageUrl] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [imageText, setImageText] = useState('')
  const [addTextOverlay, setAddTextOverlay] = useState(true)
  const [addToStory, setAddToStory] = useState(false)
  const [contentType, setContentType] = useState<'image+text' | 'text'>('image+text')

  // Publish
  const [scheduledAt, setScheduledAt] = useState('')
  const [published, setPublished] = useState<any>(null)

  // Web search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{title:string;snippet:string;url:string;date:string;source:string}[]>([])
  const [selectedResultIdxs, setSelectedResultIdxs] = useState<Set<number>>(new Set())
  const [searching, setSearching] = useState(false)

  // UI
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const gradientBtn = 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white'

  useEffect(() => {
    fetch('/api/instagram/templates').then(r => r.json())
      .then(d => setTemplates(d.templates || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (step !== 2 || !caption.trim()) { setScore(null); return }
    setScoring(true)
    const t = setTimeout(() => {
      api.scoreInstagramPost({ caption, hashtags })
        .then(setScore)
        .catch(() => setScore(null))
        .finally(() => setScoring(false))
    }, 2000)
    return () => clearTimeout(t)
  }, [caption, hashtags, step])

  const searchNews = async () => {
    const q = searchQuery.trim() || topic.trim()
    if (!q) return
    setSearching(true); setError('')
    setSearchResults([]); setSelectedResultIdxs(new Set())
    try {
      const r = await post('/search-news', { query: q })
      if (r.error) { setError(r.error); return }
      const results = r.results || []
      setSearchResults(results)
      // auto-select all by default
      setSelectedResultIdxs(new Set(results.map((_: unknown, i: number) => i)))
    } catch (e) {
      setError((e as Error).message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const toggleResultIdx = (i: number) => {
    setSelectedResultIdxs(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const buildSearchContext = () => {
    if (searchResults.length === 0 || selectedResultIdxs.size === 0) return ''
    return searchResults
      .filter((_, i) => selectedResultIdxs.has(i))
      .map(r => `• ${r.title} (${r.date || 'recent'}): ${r.snippet}`)
      .join('\n\n')
  }

  const generateCaption = async () => {
    if (!topic.trim()) return
    setLoading(true); setError('')
    const ctx = buildSearchContext()
    try {
      const r = await post('/generate-caption', {
        topic, tone, hashtag_count: hashtagCount,
        template_prompt: selectedTemplate.id !== '__none__' ? selectedTemplate.prompt : undefined,
        search_context: ctx || undefined,
      })
      if (r.error) { setError(r.error); return }
      const cap = r.caption || ''
      setCaption(cap)
      setHashtags(r.hashtags || [])
      setUsedTemplate(selectedTemplate.id !== '__none__' ? selectedTemplate : null)
      // Auto-fill image message with the caption's first meaningful line
      if (!imageText && cap) {
        const firstLine = cap.split('\n').map((l: string) => l.trim()).find((l: string) => l.length > 5) || ''
        setImageText(firstLine.slice(0, 80))
      }
      // Auto-advance to the image step
      setStep(3)
    } catch (e) {
      setError((e as Error).message || 'Failed to generate caption')
    } finally {
      setLoading(false)
    }
  }

  const generateImage = async () => {
    setLoading(true); setError(''); setImageUrl('')
    try {
      const r = await post('/generate-image', {
        topic, caption,
        custom_prompt: customPrompt || undefined,
        add_text_overlay: addTextOverlay && !!imageText,
        overlay_text: imageText || undefined,
        template_prompt: selectedTemplate.id !== '__none__' ? selectedTemplate.prompt : undefined,
      })
      const err = r.error || r.detail
      if (err) { setError(typeof err === 'string' ? err : JSON.stringify(err)); return }
      const url = r.url || r.image_url || ''
      if (!url) { setError('No image URL returned — check your OpenAI key in Settings → AI Providers'); return }
      setImageUrl(url)
      setContentType('image+text')
    } catch (e) {
      setError((e as Error).message || 'Failed to generate image')
    } finally {
      setLoading(false)
    }
  }

  const publish = async () => {
    setLoading(true); setError('')
    try {
      const r = await post('/publish', {
        caption, hashtags,
        image_url: contentType === 'image+text' ? imageUrl || undefined : undefined,
        content_type: contentType,
        scheduled_at: scheduledAt || undefined,
        topic,
        add_to_story: addToStory,
      })
      if (r.error) { setError(r.error); return }
      setPublished(r)
    } catch (e) {
      setError((e as Error).message || 'Failed to publish')
    } finally {
      setLoading(false)
    }
  }

  const applyOverlay = async () => {
    if (!imageUrl || !imageText) return
    setLoading(true); setError('')
    try {
      const r = await post('/apply-overlay', { image_url: imageUrl, overlay_text: imageText })
      if (r.error) { setError(r.error); return }
      if (r.url) setImageUrl(r.url)
    } catch (e) {
      setError((e as Error).message || 'Failed to apply text overlay')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setStep(1); setTopic(''); setTone('Inspiring'); setHashtagCount(15)
    setCaption(''); setHashtags([]); setImageUrl(''); setCustomPrompt('')
    setContentType('image+text'); setScheduledAt(''); setError(''); setPublished(null)
    setSelectedTemplate(NO_TEMPLATE); setUsedTemplate(null)
    setAddTextOverlay(false); setAddToStory(false); setImageText('')
    setSearchQuery(''); setSearchResults([]); setSelectedResultIdxs(new Set()); setSearching(false)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      <StepIndicator current={step} />

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
      )}

      {/* ── Step 1: Template ── */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Choose a caption style</h2>
            <p className="text-xs text-gray-400 mt-1">Templates shape the tone and structure of your caption.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[NO_TEMPLATE, ...templates].map(t => {
              const active = selectedTemplate.id === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTemplate(t); if (t.id !== '__none__') setTone(t.tone) }}
                  className={`flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left transition-all ${
                    active
                      ? 'border-purple-400 bg-gradient-to-br from-yellow-50/60 via-red-50/40 to-purple-50/60 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-3xl">{t.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{t.name}</p>
                    {t.id !== '__none__' && (
                      <p className="text-[11px] text-gray-400 mt-0.5">{t.tone} tone</p>
                    )}
                    {t.id === '__none__' && (
                      <p className="text-[11px] text-gray-400 mt-0.5">Your own style</p>
                    )}
                  </div>
                  {active && (
                    <span className="self-end text-purple-500 text-xs font-medium">✓ Selected</span>
                  )}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => setStep(2)}
            className={`w-full py-3 rounded-xl text-sm font-medium hover:opacity-90 transition ${gradientBtn}`}
          >
            {selectedTemplate.id !== '__none__' ? `Continue with ${selectedTemplate.name} →` : 'Continue →'}
          </button>
        </div>
      )}

      {/* ── Step 2: Your Post ── */}
      {step === 2 && (
        <div className="space-y-5">
          <h2 className="text-base font-semibold text-gray-900">Build your post</h2>

          {/* Section A — Description */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">✍️ Your Description</p>
              <span className="text-[11px] text-gray-400">Required</span>
            </div>
            <textarea
              className="w-full h-28 px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 placeholder-gray-400"
              placeholder={"Describe what you want to post about in detail.\n\ne.g. 'I want to raise awareness about human rights in Iran, focusing on the recent wave of executions targeting protesters. The regime is silencing dissent...'"}
              value={topic}
              onChange={e => setTopic(e.target.value)}
              autoFocus
            />
          </div>

          {/* Section B — Web Search */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">🌐 Search the Web</p>
              <span className="text-[11px] text-gray-400">Optional — adds real news to your post</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 placeholder-gray-400"
                placeholder="Search query, e.g. 'human rights Iran 2026'"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchQuery.trim() && searchNews()}
              />
              <button
                onClick={searchNews}
                disabled={!searchQuery.trim() || searching}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition"
              >
                {searching ? <Spinner /> : '🔍'}
                <span className="whitespace-nowrap">{searching ? 'Searching…' : 'Search'}</span>
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="rounded-xl border border-blue-100 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border-b border-blue-100">
                  <p className="text-xs font-semibold text-blue-700">Check the results you want to include</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setSelectedResultIdxs(
                        selectedResultIdxs.size === searchResults.length
                          ? new Set()
                          : new Set(searchResults.map((_, i) => i))
                      )}
                      className="text-[10px] text-blue-500 hover:text-blue-700 font-medium"
                    >
                      {selectedResultIdxs.size === searchResults.length ? 'Deselect all' : 'Select all'}
                    </button>
                    <button onClick={() => { setSearchResults([]); setSelectedResultIdxs(new Set()) }} className="text-[10px] text-gray-400 hover:text-gray-600">Clear</button>
                  </div>
                </div>
                <div className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
                  {searchResults.map((r, i) => {
                    const checked = selectedResultIdxs.has(i)
                    return (
                      <div key={i} onClick={() => toggleResultIdx(i)}
                        className={`px-3 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}>
                        <div className="flex items-start gap-2.5">
                          <div className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${checked ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'}`}>
                            {checked && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium line-clamp-1 ${checked ? 'text-gray-900' : 'text-gray-500'}`}>{r.title}</p>
                            {checked && <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{r.snippet}</p>}
                            <div className="flex items-center gap-2 mt-0.5">
                              {r.source && <span className="text-[10px] text-blue-500 font-medium">{r.source}</span>}
                              {r.date && <span className="text-[10px] text-gray-400">{r.date}</span>}
                            </div>
                          </div>
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="flex-shrink-0 text-[10px] text-blue-400 hover:text-blue-600 mt-0.5">↗</a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {selectedResultIdxs.size > 0 && (
                  <div className="px-3 py-1.5 bg-blue-100 border-t border-blue-200">
                    <p className="text-[11px] text-blue-700 font-medium">{selectedResultIdxs.size} of {searchResults.length} news items selected</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Template prompt preview */}
          {selectedTemplate.id !== '__none__' && (
            <div className="rounded-xl border border-purple-200 bg-purple-50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-purple-100">
                <span className="text-base">{selectedTemplate.icon}</span>
                <span className="text-xs font-semibold text-purple-700">{selectedTemplate.name} — template instructions</span>
              </div>
              <p className="px-3 py-2.5 text-xs text-purple-800 leading-relaxed">{selectedTemplate.prompt}</p>
            </div>
          )}

          {/* Final prompt preview — assembles everything together */}
          {(selectedTemplate.id !== '__none__' || topic.trim()) && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
                <span className="text-xs font-semibold text-gray-600">Final prompt that will be sent to AI</span>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {selectedTemplate.id !== '__none__' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700">{selectedTemplate.icon} {selectedTemplate.name}</span>
                  )}
                  {topic.trim() && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">✍️ your description</span>
                  )}
                  {selectedResultIdxs.size > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">🌐 {selectedResultIdxs.size} news</span>
                  )}
                </div>
              </div>
              <div className="px-3 py-2.5 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-mono bg-white">
                {[
                  selectedTemplate.id !== '__none__' ? selectedTemplate.prompt : '',
                  topic.trim() ? `\nTopic: ${topic.trim()}` : '',
                  `\nTone: ${tone}`,
                  selectedResultIdxs.size > 0 ? `\n\nNews context:\n${buildSearchContext()}` : '',
                ].filter(Boolean).join('').trim() || <span className="text-gray-400 italic">Enter a description above to see the assembled prompt</span>}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Tone</p>
            <div className="flex flex-wrap gap-2">
              {TONES.map(t => (
                <button key={t} onClick={() => setTone(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    tone === t ? gradientBtn : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500">Hashtags</p>
              <span className="text-xs font-semibold text-purple-600">{hashtagCount}</span>
            </div>
            <input type="range" min={5} max={30} value={hashtagCount}
              onChange={e => setHashtagCount(Number(e.target.value))}
              className="w-full accent-purple-500" />
          </div>

          <button
            onClick={generateCaption}
            disabled={!topic.trim() || loading}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition ${gradientBtn}`}
          >
            {loading ? <Spinner /> : null}
            ✨ Generate Caption
          </button>

          {caption ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-gray-500">Caption</p>
                <div className="flex items-center gap-2">
                  {selectedResultIdxs.size > 0 && searchResults.length > 0 && <span className="text-[11px] text-blue-600 font-medium">🌐 {selectedResultIdxs.size} news items</span>}
                  {usedTemplate && <span className="text-[11px] text-pink-600 font-medium">{usedTemplate.icon} {usedTemplate.name}</span>}
                </div>
              </div>
              <textarea
                className="w-full h-40 px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
                value={caption}
                onChange={e => setCaption(e.target.value)}
              />
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {hashtags.map(h => (
                    <span key={h} className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full text-[11px] font-medium">#{h}</span>
                  ))}
                </div>
              )}
              {(score || scoring) && (
                <div className="mt-3">
                  <PostScoreWidget
                    score={score?.score ?? 0}
                    factors={score?.factors ?? { length: 0, hashtags: 0, cta: false, timing: false, hook: false }}
                    suggestions={score?.suggestions ?? []}
                    loading={scoring && !score}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="h-32 border border-dashed border-gray-200 rounded-xl flex items-center justify-center">
              <p className="text-xs text-gray-400">Your caption will appear here after generating</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!caption.trim()}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition ${gradientBtn}`}
            >
              Next: Add Image →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Image ── */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Add an Image</h2>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <p className="text-[11px] font-medium text-gray-400 mb-1">Caption preview</p>
            <p className="text-xs text-gray-600 line-clamp-3 whitespace-pre-wrap">{caption}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">Custom image style (optional)</p>
            <textarea
              className="w-full h-16 px-3 py-2 border border-gray-200 rounded-xl text-xs resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 placeholder-gray-400"
              placeholder="e.g. 'Warm tones, flat-lay, cozy aesthetic, no text'"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
            />
          </div>

          {/* Message on image */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">📝 Message on image</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Short text burned into the image so viewers see the message at a glance</p>
              </div>
              <Toggle value={addTextOverlay} onChange={setAddTextOverlay} />
            </div>
            {addTextOverlay && (
              <div className="space-y-2">
                <textarea
                  className="w-full h-14 px-3 py-2 border border-amber-300 rounded-xl text-xs resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder-gray-400 bg-white"
                  placeholder="e.g. Freedom for Iran · Stop the Executions · Justice for Mahsa"
                  value={imageText}
                  onChange={e => setImageText(e.target.value)}
                  maxLength={120}
                />
                {imageUrl && imageText && (
                  <button onClick={applyOverlay}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-semibold hover:bg-amber-600 transition">
                    ✏️ Apply text to current image
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Toggles */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-4 py-3 bg-pink-50 border border-pink-100 rounded-xl">
              <div>
                <p className="text-sm font-medium text-gray-700">Also post to Story</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Publishes the same image to your Instagram Story</p>
              </div>
              <Toggle value={addToStory} onChange={setAddToStory} />
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              <div className="aspect-square max-w-xs bg-gray-100 rounded-xl animate-pulse" />
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Spinner /> Generating image… this can take up to 60 seconds
              </div>
            </div>
          ) : imageUrl ? (
            <div className="space-y-3">
              <img src={imageUrl} alt="Generated"
                className="w-full max-w-xs aspect-square object-cover rounded-xl border border-gray-200"
                onError={() => setError(`Image uploaded but preview failed to load. URL: ${imageUrl} — check Public URL Base in Settings.`)}
              />
              <div className="flex gap-2 flex-wrap">
                <button onClick={generateImage} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-200 transition">
                  Regenerate
                </button>
                {addTextOverlay && imageText && (
                  <button onClick={applyOverlay} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-semibold hover:bg-amber-600 transition">
                    ✏️ Apply text to image
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button onClick={generateImage}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition ${gradientBtn}`}
            >
              Generate Image
            </button>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(2)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button onClick={() => { setContentType('text'); setStep(4) }}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Skip — Text Only
            </button>
            <button
              onClick={() => { setContentType('image+text'); setStep(4) }}
              disabled={!imageUrl}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition ${gradientBtn}`}
            >
              Next: Preview →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Preview & Post ── */}
      {step === 4 && (
        <div className="space-y-5">
          {published ? (
            <PublishedScreen
              published={published}
              addToStory={addToStory}
              onViewHistory={onViewHistory}
              onReset={reset}
              gradientBtn={gradientBtn}
            />
          ) : (
            <>
              <h2 className="text-base font-semibold text-gray-900">Preview & Post</h2>

              {/* Feed preview */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Feed Preview</p>
                <div className="max-w-xs mx-auto border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600" />
                    <span className="text-xs font-semibold">your_account</span>
                  </div>
                  {contentType === 'image+text' && imageUrl && (
                    <img src={imageUrl} className="w-full aspect-square object-cover" alt="Post" />
                  )}
                  <div className="px-3 py-2">
                    <p className="text-xs text-gray-800 whitespace-pre-wrap line-clamp-4">{caption}</p>
                    {hashtags.length > 0 && (
                      <p className="text-xs text-blue-500 mt-1 line-clamp-2">{hashtags.map(h => `#${h}`).join(' ')}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Story preview */}
              {addToStory && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Story Preview</p>
                  <div className="max-w-[110px] mx-auto rounded-2xl overflow-hidden border-2 border-purple-200 bg-black" style={{ aspectRatio: '9/16' }}>
                    {contentType === 'image+text' && imageUrl ? (
                      <img src={imageUrl} className="w-full h-full object-cover" alt="Story" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-2">
                        <p className="text-white text-[9px] text-center leading-relaxed">{caption.slice(0, 100)}</p>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-center text-purple-500 font-medium mt-1.5">+ Story (9:16)</p>
                </div>
              )}

              {/* Schedule */}
              <div className="border-t border-gray-100 pt-4 space-y-2">
                <p className="text-xs font-medium text-gray-500">Schedule (optional)</p>
                <input type="datetime-local"
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
                  value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
                <p className="text-[11px] text-gray-400">Leave empty to post immediately.</p>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(3)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                  Back
                </button>
                <button onClick={publish} disabled={loading}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition ${gradientBtn}`}
                >
                  {loading ? <Spinner /> : null}
                  {scheduledAt ? 'Schedule →' : addToStory ? 'Post to Feed + Story →' : 'Post Now →'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PublishedScreen({ published, addToStory, onViewHistory, onReset, gradientBtn }: {
  published: any; addToStory: boolean; onViewHistory: () => void; onReset: () => void; gradientBtn: string
}) {
  const storyOk = published.story && !published.story.error
  const storyErr = published.story?.error

  return (
    <div className="space-y-5 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600">
          <span className="text-3xl text-white">✓</span>
        </div>
        <h2 className="text-base font-semibold text-gray-900">
          {published.scheduled_for ? `Scheduled for ${published.scheduled_for}` : 'Posted to Instagram!'}
        </h2>
        {addToStory && storyOk && (
          <p className="text-sm text-purple-600 font-medium">Also posted to your Story ✓</p>
        )}
        {addToStory && storyErr && (
          <p className="text-xs text-red-500">Story failed: {storyErr}</p>
        )}
      </div>
      <div className="flex gap-2 justify-center pt-2">
        <button onClick={onViewHistory}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition">
          View History
        </button>
        <button onClick={onReset}
          className={`px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition ${gradientBtn}`}>
          Create Another Post
        </button>
      </div>
    </div>
  )
}
