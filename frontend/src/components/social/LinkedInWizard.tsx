import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import { PostScoreWidget } from './PostScoreWidget'
import type { PostScore } from '../../types'

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

const STEPS = ['Topic', 'Trends', 'Write', 'Style', 'Images', 'Schedule', 'Done']

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

export function LinkedInWizard({ onViewHistory, onManageTemplates }: { onViewHistory: () => void; onManageTemplates?: () => void }) {
  const [step, setStep] = useState(1)
  const [subject, setSubject] = useState('')
  const [trends, setTrends] = useState<Trend[]>([])
  const [selectedTrend, setSelectedTrend] = useState<Trend | null>(null)
  const [audience, setAudience] = useState('General')
  const [tone, setTone] = useState('Professional')
  const [post, setPost] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [score, setScore] = useState<PostScore | null>(null)
  const [scoring, setScoring] = useState(false)
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
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (step !== 3 || !post.trim()) { setScore(null); return }
    setScoring(true)
    const t = setTimeout(() => {
      api.scoreLinkedInPost({ post_text: post, hashtags })
        .then(setScore)
        .catch(() => setScore(null))
        .finally(() => setScoring(false))
    }, 2000)
    return () => clearTimeout(t)
  }, [post, hashtags, step])

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
      // Auto-advance to image style step
      goToStylePicker()
    } catch (e) {
      setError((e as Error).message || 'Failed to generate post')
    } finally {
      setLoading(false)
    }
  }

  // Step 4 — load templates, no image generation yet
  const goToStylePicker = async () => {
    setStep(4); setImages([]); setSelectedImage(null); setError('')
    setTemplatesLoading(true)
    try {
      const r = await (api as any).getLinkedInTemplates().catch(() => ({ templates: [] }))
      setTemplates(r.templates || [])
    } catch {
      setTemplates([])
    } finally {
      setTemplatesLoading(false)
    }
  }

  // Step 5 — generate 1 image using selected template (or none)
  const generateImages = async (tmpl?: LinkedInTemplate) => {
    const prompt = tmpl ? tmpl.prompt : (customPrompt || undefined)
    if (tmpl) { setSelectedTemplate(tmpl.id); setCustomPrompt(tmpl.prompt) }
    setStep(5); setImgLoading(true); setError(''); setImages([]); setSelectedImage(null)
    try {
      const r = await (api as any).generateLinkedInImages({
        topic: selectedTrend?.title,
        post_text: post,
        custom_prompt: prompt,
      })
      if (r.error) { setError(r.error); return }
      const imgs = r.images || []
      setImages(imgs)
      if (imgs.length > 0) setSelectedImage(0)  // auto-select the single image
    } catch (e) {
      setError((e as Error).message || 'Failed to generate image')
    } finally {
      setImgLoading(false)
    }
  }

  const regenImages = async () => {
    setImgLoading(true); setError(''); setImages([]); setSelectedImage(null)
    try {
      const r = await (api as any).generateLinkedInImages({
        topic: selectedTrend?.title,
        post_text: post,
        custom_prompt: customPrompt || undefined,
      })
      if (r.error) { setError(r.error); return }
      const imgs = r.images || []
      setImages(imgs)
      if (imgs.length > 0) setSelectedImage(0)
    } catch (e) {
      setError((e as Error).message || 'Failed to regenerate image')
    } finally {
      setImgLoading(false)
    }
  }

  const publish = async () => {
    setLoading(true); setError('')
    try {
      const hashtagLine = hashtags.length > 0 ? '\n\n' + hashtags.map(h => `#${h}`).join(' ') : ''
      const r = await (api as any).publishLinkedInPost({
        post_text: post + hashtagLine,
        image_url: selectedImage !== null && selectedImage >= 0 ? images[selectedImage]?.url : undefined,
        content_type: contentType,
        scheduled_at: scheduleMode === 'schedule' ? scheduleDate : undefined,
        topic: selectedTrend?.title || subject,
        subject,
      })
      if (r.error) { setError(r.error); return }
      setPublishResult(r)
      setStep(7)
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
    setTemplates([]); setSelectedTemplate(null); setTemplatesLoading(false)
  }

  const engagementColor = (e: string) =>
    e === 'High' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      {/* Template Library shortcut — always visible */}
      {onManageTemplates && (
        <button
          onClick={onManageTemplates}
          className="flex items-center justify-between w-full mb-4 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl hover:bg-blue-100 transition group"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">📚</span>
            <div className="text-left">
              <p className="text-sm font-semibold text-blue-800">Prompt Template Library</p>
              <p className="text-xs text-blue-500">Add your own image styles with sample images — used in Step 4</p>
            </div>
          </div>
          <span className="text-blue-400 text-sm group-hover:translate-x-0.5 transition-transform">→</span>
        </button>
      )}

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

              {/* Final prompt preview */}
          <div className="rounded-xl border border-blue-100 bg-blue-50 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-blue-100">
              <span className="text-xs font-semibold text-blue-700">Final prompt that will be sent to AI</span>
            </div>
            <div className="px-3 py-2.5 text-xs text-blue-900 leading-relaxed font-mono whitespace-pre-wrap bg-white">
              {[
                `Topic: ${selectedTrend?.title || '—'}`,
                `About: ${subject || '—'}`,
                `Audience: ${audience}`,
                `Tone: ${tone}`,
                selectedTrend?.description ? `\nContext: ${selectedTrend.description}` : '',
              ].filter(Boolean).join('\n')}
            </div>
          </div>

          <button
            onClick={generatePost}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
          >
            {loading ? <Spinner /> : null}
            {post ? '↺ Regenerate Post' : '✨ Generate Post & Continue →'}
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
              {(score || scoring) && (
                <PostScoreWidget
                  score={score?.score ?? 0}
                  factors={score?.factors ?? { length: 0, hashtags: 0, cta: false, timing: false, hook: false }}
                  suggestions={score?.suggestions ?? []}
                  loading={scoring && !score}
                />
              )}
            </>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(2)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={goToStylePicker}
              disabled={!post}
              className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              Choose Image Style →
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Pick image style / template */}
      {step === 4 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Choose an Image Style</h2>
            <p className="text-xs text-gray-400 mt-1">Pick a visual style for your post image, or skip to generate without one.</p>
          </div>

          {templatesLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400"><Spinner /> Loading styles…</div>
          ) : templates.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center space-y-1">
              <span className="text-2xl">🎨</span>
              <p className="text-sm text-gray-500">No templates yet</p>
              <p className="text-xs text-gray-400">Add styles in the Prompt Template Library →</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {templates.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => setSelectedTemplate(prev => prev === tmpl.id ? null : tmpl.id)}
                  title={tmpl.prompt}
                  className={`text-left border-2 rounded-xl overflow-hidden transition-all ${
                    selectedTemplate === tmpl.id
                      ? 'border-accent shadow-md ring-2 ring-blue-100'
                      : 'border-gray-200 hover:border-gray-400 bg-white'
                  }`}
                >
                  {/* Mini post mockup */}
                  <div className="bg-white">
                    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
                      <div className="w-5 h-5 bg-blue-600 rounded-full flex-shrink-0" />
                      <div className="flex-1 space-y-1">
                        <div className="h-1.5 bg-gray-200 rounded-full w-full" />
                        <div className="h-1 bg-gray-100 rounded-full w-2/3" />
                      </div>
                    </div>
                    <div className="w-full aspect-video bg-gray-100 overflow-hidden flex items-center justify-center">
                      {tmpl.sample_image ? (
                        <img src={tmpl.sample_image} alt={tmpl.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">{tmpl.icon || '🎨'}</span>
                      )}
                    </div>
                  </div>
                  <div className="px-3 py-2 bg-white border-t border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-gray-800 line-clamp-1">{tmpl.name}</p>
                      <p className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">{tmpl.prompt.slice(0, 50)}…</p>
                    </div>
                    {selectedTemplate === tmpl.id && (
                      <div className="w-5 h-5 bg-accent rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                        <span className="text-white text-[9px] font-bold">✓</span>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Selected template prompt display */}
          {selectedTemplate && templates.find(t => t.id === selectedTemplate) && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-blue-100">
                <span className="text-base">{templates.find(t => t.id === selectedTemplate)?.icon || '🎨'}</span>
                <span className="text-xs font-semibold text-blue-700">{templates.find(t => t.id === selectedTemplate)?.name} — style instructions</span>
              </div>
              <p className="px-3 py-2.5 text-xs text-blue-800 leading-relaxed">{templates.find(t => t.id === selectedTemplate)?.prompt}</p>
            </div>
          )}

          {/* Custom prompt override */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">Or describe your own style</p>
            <textarea
              className="w-full h-20 px-3 py-2 border border-gray-200 rounded-xl text-xs resize-none focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent placeholder-gray-400"
              placeholder="e.g. 'Minimalist design, white background, bold typography, no faces'"
              value={customPrompt}
              onChange={e => { setCustomPrompt(e.target.value); if (e.target.value) setSelectedTemplate(null) }}
            />
          </div>

          {/* Final image prompt preview */}
          {(selectedTemplate || customPrompt.trim()) && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
                <span className="text-xs font-semibold text-gray-600">Final image prompt that will be sent to DALL-E</span>
                {selectedTemplate && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
                    {templates.find(t => t.id === selectedTemplate)?.name}
                  </span>
                )}
              </div>
              <div className="px-3 py-2.5 text-xs text-gray-700 leading-relaxed font-mono whitespace-pre-wrap bg-white">
                {[
                  selectedTemplate
                    ? templates.find(t => t.id === selectedTemplate)?.prompt
                    : customPrompt.trim(),
                  selectedTrend?.title ? `\n\nPost topic: ${selectedTrend.title}` : '',
                  post ? `\nPost text: ${post.slice(0, 120)}…` : '',
                ].filter(Boolean).join('').trim()}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => setStep(3)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={() => generateImages()}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
            >
              Skip — No Style
            </button>
            <button
              onClick={() => {
                const tmpl = templates.find(t => t.id === selectedTemplate)
                generateImages(tmpl)
              }}
              disabled={!selectedTemplate && !customPrompt.trim()}
              className="flex-1 px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              Generate with this Style →
            </button>
          </div>
        </div>
      )}

      {/* Step 5 — Generated Image */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Generated Image</h2>
            <button
              onClick={goToStylePicker}
              className="text-xs text-accent hover:underline"
            >
              ← Change style
            </button>
          </div>

          {imgLoading ? (
            <div className="space-y-3">
              <div className="aspect-video bg-gray-100 rounded-xl animate-pulse" />
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Spinner />
                <span>Generating image… this can take up to 60 seconds</span>
              </div>
            </div>
          ) : images.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center space-y-2">
              <span className="text-3xl">🖼️</span>
              <p className="text-sm font-medium text-gray-600">No image generated</p>
              <p className="text-xs text-gray-400">
                {error ? 'See error above — check your OpenAI API key in Settings' : 'Click Try Again or go back to choose a different style'}
              </p>
              <button
                onClick={regenImages}
                className="mt-2 px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition"
              >
                Try Again
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden border border-gray-200">
                <img src={images[0].url} alt={images[0].prompt} className="w-full object-cover rounded-xl" />
              </div>
              <p className="text-[11px] text-gray-400 leading-snug">{images[0].prompt}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedImage(0)}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border-2 transition ${
                    selectedImage === 0
                      ? 'border-accent bg-accent text-white'
                      : 'border-gray-200 text-gray-700 hover:border-accent'
                  }`}
                >
                  {selectedImage === 0 ? '✓ Using this image' : 'Use this image'}
                </button>
                <button
                  onClick={() => setSelectedImage(-1)}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border-2 transition ${
                    selectedImage === -1
                      ? 'border-accent bg-accent text-white'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Skip — No Image
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent placeholder-gray-400"
              placeholder="Tweak the prompt and regenerate…"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
            />
            <button
              onClick={regenImages}
              disabled={imgLoading}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-200 disabled:opacity-50 transition"
            >
              {imgLoading ? 'Generating…' : 'Regenerate'}
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={goToStylePicker} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={() => setStep(6)}
              disabled={selectedImage === null}
              className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              Review & Publish →
            </button>
          </div>
        </div>
      )}

      {/* Step 6 — Content Type & Schedule */}
      {step === 6 && (
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
            <button onClick={() => setStep(5)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
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

      {/* Step 7 — Done */}
      {step === 7 && (
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
