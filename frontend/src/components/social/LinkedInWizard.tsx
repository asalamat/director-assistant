import { useState } from 'react'
import { api } from '../../api/client'

interface Trend {
  title: string
  description: string
  engagement: string
  hashtags: string[]
}

interface GeneratedImage {
  url: string
  prompt: string
}

interface LinkedInTemplate {
  id: string
  name: string
  prompt: string
  sample_image: string
  builtin: number
  icon?: string
}

const STEPS = ['Topic', 'Trends', 'Write', 'Images', 'Schedule', 'Done']

const AUDIENCES = ['Executives', 'Developers', 'Marketers', 'General']
const TONES = ['Professional', 'Conversational', 'Inspirational', 'Educational']

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
              done ? 'bg-accent text-white' : active ? 'bg-accent text-white ring-2 ring-blue-200' : 'bg-gray-100 text-gray-400'
            }`}>
              {done ? '✓' : n}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-6 rounded-full ${n < current ? 'bg-accent' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
      <span className="ml-2 text-xs text-gray-400">{STEPS[current - 1]}</span>
    </div>
  )
}

function Spinner() {
  return <span className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
}

export function LinkedInWizard({ onViewHistory }: { onViewHistory: () => void }) {
  const [step, setStep] = useState(1)
  const [subject, setSubject] = useState('')
  const [trends, setTrends] = useState<Trend[]>([])
  const [selectedTrend, setSelectedTrend] = useState<Trend | null>(null)
  const [audience, setAudience] = useState('General')
  const [tone, setTone] = useState('Professional')
  const [post, setPost] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [selectedImage, setSelectedImage] = useState<number | null>(null) // null=none chosen, -1=no image
  const [customPrompt, setCustomPrompt] = useState('')
  const [contentType, setContentType] = useState<'article' | 'image' | 'image+text'>('image+text')
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now')
  const [scheduleDate, setScheduleDate] = useState('')
  const [publishResult, setPublishResult] = useState<{ status: string; scheduled_for?: string } | null>(null)
  const [templates, setTemplates] = useState<LinkedInTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [imgLoading, setImgLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchTrends = async () => {
    if (!subject.trim()) return
    setLoading(true); setError('')
    try {
      const r = await (api as any).getLinkedInTrends(subject)
      setTrends(r.trends)
      setStep(2)
    } catch (e) {
      setError((e as Error).message || 'Failed to fetch trends')
    } finally {
      setLoading(false)
    }
  }

  const generatePost = async () => {
    if (!selectedTrend) return
    setLoading(true); setError('')
    try {
      const r = await (api as any).generateLinkedInPost({ topic: selectedTrend.title, audience, tone, subject })
      setPost(r.post)
      setHashtags(r.hashtags || [])
    } catch (e) {
      setError((e as Error).message || 'Failed to generate post')
    } finally {
      setLoading(false)
    }
  }

  const goToImages = async () => {
    setStep(4); setImgLoading(true); setError('')
    try {
      const [imgR, tmplR] = await Promise.all([
        (api as any).generateLinkedInImages({
          topic: selectedTrend?.title,
          post_text: post,
          custom_prompt: customPrompt || undefined,
        }),
        (api as any).getLinkedInTemplates().catch(() => ({ templates: [] })),
      ])
      setImages(imgR.images || [])
      setTemplates(tmplR.templates || [])
    } catch (e) {
      setError((e as Error).message || 'Failed to generate images')
    } finally {
      setImgLoading(false)
    }
  }

  const applyTemplate = async (tmpl: LinkedInTemplate) => {
    setSelectedTemplate(tmpl.id)
    setCustomPrompt(tmpl.prompt)
    setImgLoading(true); setError('')
    try {
      const r = await (api as any).generateLinkedInImages({
        topic: selectedTrend?.title,
        post_text: post,
        custom_prompt: tmpl.prompt,
      })
      setImages(r.images || [])
      setSelectedImage(null)
    } catch (e) {
      setError((e as Error).message || 'Failed to regenerate images')
    } finally {
      setImgLoading(false)
    }
  }

  const regenImages = async () => {
    setImgLoading(true); setError('')
    try {
      const r = await (api as any).generateLinkedInImages({
        topic: selectedTrend?.title,
        post_text: post,
        custom_prompt: customPrompt || undefined,
      })
      setImages(r.images || [])
    } catch (e) {
      setError((e as Error).message || 'Failed to regenerate images')
    } finally {
      setImgLoading(false)
    }
  }

  const publish = async () => {
    setLoading(true); setError('')
    try {
      const r = await (api as any).publishLinkedInPost({
        post,
        hashtags,
        image_url: selectedImage !== null && selectedImage >= 0 ? images[selectedImage]?.url : undefined,
        content_type: contentType,
        schedule_at: scheduleMode === 'schedule' ? scheduleDate : undefined,
      })
      setPublishResult(r)
      setStep(6)
    } catch (e) {
      setError((e as Error).message || 'Failed to publish')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setStep(1); setSubject(''); setTrends([]); setSelectedTrend(null)
    setPost(''); setHashtags([]); setImages([]); setSelectedImage(null)
    setCustomPrompt(''); setContentType('image+text'); setScheduleMode('now')
    setScheduleDate(''); setPublishResult(null); setError('')
    setTemplates([]); setSelectedTemplate(null)
  }

  const engagementColor = (e: string) =>
    e === 'High' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      <StepIndicator current={step} />

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
      )}

      {/* Step 1 — Subject */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">What do you want to post about?</h2>
          <textarea
            className="w-full h-32 px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent placeholder-gray-400"
            placeholder="Enter a topic, idea, or keyword (e.g. 'AI in healthcare', 'remote work productivity')"
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
          <button
            onClick={fetchTrends}
            disabled={!subject.trim() || loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? <Spinner /> : null}
            Find Trending Topics →
          </button>
        </div>
      )}

      {/* Step 2 — Trends */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Trending Topics</h2>
          {trends.length === 0 && <div className="flex items-center gap-2 text-sm text-gray-400"><Spinner /> Loading…</div>}
          <div className="space-y-3">
            {trends.map((t, i) => (
              <button
                key={i}
                onClick={() => setSelectedTrend(t)}
                className={`w-full text-left border rounded-xl p-4 transition-colors ${
                  selectedTrend?.title === t.title
                    ? 'border-accent bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-semibold text-gray-900 text-sm">{t.title}</span>
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${engagementColor(t.engagement)}`}>
                    {t.engagement}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{t.description}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {t.hashtags.map(h => (
                    <span key={h} className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[11px]">#{h}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!selectedTrend}
              className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              Generate Post →
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Generate Post */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Craft Your Post</h2>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Audience</p>
            <div className="flex flex-wrap gap-2">
              {AUDIENCES.map(a => (
                <button
                  key={a}
                  onClick={() => setAudience(a)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    audience === a ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Tone</p>
            <div className="flex flex-wrap gap-2">
              {TONES.map(t => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    tone === t ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={generatePost}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? <Spinner /> : null}
            {post ? 'Regenerate' : 'Generate Post'}
          </button>

          {post && (
            <>
              <div className="relative">
                <textarea
                  className="w-full h-48 px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                  value={post}
                  onChange={e => setPost(e.target.value)}
                />
                <span className={`absolute bottom-3 right-3 text-[11px] font-medium ${post.length > 3000 ? 'text-red-500' : 'text-gray-400'}`}>
                  {post.length}/3000
                </span>
              </div>
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {hashtags.map(h => (
                    <span key={h} className="px-2 py-0.5 bg-blue-50 text-accent rounded-full text-[11px] font-medium">#{h}</span>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(2)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={goToImages}
              disabled={!post}
              className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              Generate Images →
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Images */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Choose an Image</h2>

          {/* Template Style Picker */}
          {templates.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Choose a visual style — click to apply</p>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {templates.map(tmpl => (
                  <button
                    key={tmpl.id}
                    onClick={() => applyTemplate(tmpl)}
                    disabled={imgLoading}
                    title={tmpl.prompt}
                    className={`flex-shrink-0 w-28 border-2 rounded-xl overflow-hidden transition-colors disabled:opacity-50 ${
                      selectedTemplate === tmpl.id
                        ? 'border-accent shadow-sm'
                        : 'border-gray-200 hover:border-gray-400 bg-white'
                    }`}
                  >
                    {/* Mini LinkedIn post mockup */}
                    <div className="bg-white">
                      {/* Fake header */}
                      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
                        <div className="w-4 h-4 bg-blue-600 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-0.5">
                          <div className="h-1 bg-gray-200 rounded-full w-full" />
                          <div className="h-1 bg-gray-100 rounded-full w-2/3" />
                        </div>
                      </div>
                      {/* Image area */}
                      <div className="w-full aspect-video bg-gray-100 overflow-hidden flex items-center justify-center">
                        {tmpl.sample_image ? (
                          <img src={tmpl.sample_image} alt={tmpl.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xl">{tmpl.icon || '🎨'}</span>
                        )}
                      </div>
                    </div>
                    <div className="px-2 py-1.5 bg-white border-t border-gray-100">
                      <span className="text-[10px] text-gray-600 leading-tight line-clamp-1 font-medium">{tmpl.name}</span>
                      {selectedTemplate === tmpl.id && (
                        <div className="mt-0.5 text-[9px] text-accent font-semibold">✓ Applied</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {imgLoading ? (
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="aspect-square bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(i)}
                  className={`relative border-2 rounded-xl overflow-hidden transition-colors ${
                    selectedImage === i ? 'border-accent' : 'border-transparent'
                  }`}
                >
                  <img src={img.url} alt={img.prompt} className="w-full aspect-square object-cover" />
                  {selectedImage === i && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-accent rounded-full flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold">✓</span>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-500 p-1.5 truncate">{img.prompt}</p>
                </button>
              ))}
              <button
                onClick={() => setSelectedImage(-1)}
                className={`border-2 rounded-xl p-4 flex flex-col items-center justify-center gap-1 transition-colors ${
                  selectedImage === -1 ? 'border-accent bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="text-xl">📄</span>
                <span className="text-xs text-gray-500">No image</span>
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent placeholder-gray-400"
              placeholder="+ Custom prompt to regenerate…"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
            />
            <button
              onClick={regenImages}
              disabled={imgLoading}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-200 transition"
            >
              Regen
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(3)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={() => setStep(5)}
              disabled={selectedImage === null}
              className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              Review & Publish →
            </button>
          </div>
        </div>
      )}

      {/* Step 5 — Content Type & Schedule */}
      {step === 5 && (
        <div className="space-y-5">
          <h2 className="text-base font-semibold text-gray-900">How do you want to post?</h2>

          <div className="space-y-2">
            {([
              { value: 'article', icon: '📄', label: 'Article only', desc: 'Text post, no image' },
              { value: 'image', icon: '🖼', label: 'Image only', desc: 'Image with no caption' },
              { value: 'image+text', icon: '📄🖼', label: 'Image + Text', desc: 'Full post with image' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => setContentType(opt.value)}
                className={`w-full flex items-center gap-4 px-4 py-3 border-2 rounded-xl text-left transition-colors ${
                  contentType === opt.value ? 'border-accent bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="text-2xl">{opt.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-400">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-xs font-medium text-gray-500">When to post?</p>
            <div className="flex gap-2">
              {(['now', 'schedule'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setScheduleMode(m)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    scheduleMode === m ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {m === 'now' ? 'Post now' : 'Schedule'}
                </button>
              ))}
            </div>
            {scheduleMode === 'schedule' && (
              <input
                type="datetime-local"
                className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                value={scheduleDate}
                onChange={e => setScheduleDate(e.target.value)}
              />
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(4)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={publish}
              disabled={loading || (scheduleMode === 'schedule' && !scheduleDate)}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {loading ? <Spinner /> : null}
              {scheduleMode === 'now' ? 'Publish →' : 'Schedule →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 6 — Done */}
      {step === 6 && (
        <div className="space-y-5 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-base font-semibold text-gray-900">
              {publishResult?.scheduled_for ? `Post scheduled for ${publishResult.scheduled_for}` : 'Post published to LinkedIn!'}
            </h2>
          </div>

          {post && (
            <div className="text-left bg-gray-50 border border-gray-200 rounded-xl p-4">
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-6">{post}</p>
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {hashtags.map(h => (
                    <span key={h} className="text-[11px] text-accent">#{h}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-center pt-2">
            <button
              onClick={onViewHistory}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
            >
              View History
            </button>
            <button
              onClick={reset}
              className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition"
            >
              Create Another Post
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
