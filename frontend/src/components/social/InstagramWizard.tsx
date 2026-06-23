import { useState } from 'react'

const BASE = '/api/instagram'
const post = async (path: string, body: object) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

const STEPS = ['Caption', 'Image', 'Preview']
const TONES = ['Inspiring', 'Educational', 'Behind-the-scenes', 'Promotional', 'Personal']

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
              done || active
                ? 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white'
                : 'bg-gray-100 text-gray-400'
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
  return <span className="inline-block w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
}

export function InstagramWizard({ onViewHistory }: { onViewHistory: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [topic, setTopic] = useState('')
  const [tone, setTone] = useState('Inspiring')
  const [hashtagCount, setHashtagCount] = useState(15)
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [imageUrl, setImageUrl] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [contentType, setContentType] = useState<'image+text' | 'text'>('image+text')
  const [scheduledAt, setScheduledAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState<{ status: string; scheduled_for?: string } | null>(null)

  const gradientBtn = 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white'

  const generateCaption = async () => {
    if (!topic.trim()) return
    setLoading(true); setError('')
    try {
      const r = await post('/generate-caption', { topic, tone, hashtag_count: hashtagCount })
      if (r.error) { setError(r.error); return }
      setCaption(r.caption || '')
      setHashtags(r.hashtags || [])
    } catch (e) {
      setError((e as Error).message || 'Failed to generate caption')
    } finally {
      setLoading(false)
    }
  }

  const generateImage = async () => {
    setLoading(true); setError(''); setImageUrl('')
    try {
      const r = await post('/generate-image', { caption, custom_prompt: customPrompt || undefined })
      if (r.error) { setError(r.error); return }
      setImageUrl(r.url || r.image_url || '')
      if (r.url || r.image_url) setContentType('image+text')
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
        caption,
        hashtags,
        image_url: contentType === 'image+text' ? imageUrl || undefined : undefined,
        content_type: contentType,
        scheduled_at: scheduledAt || undefined,
        topic,
      })
      if (r.error) { setError(r.error); return }
      setPublished(r)
    } catch (e) {
      setError((e as Error).message || 'Failed to publish')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setStep(1); setTopic(''); setTone('Inspiring'); setHashtagCount(15)
    setCaption(''); setHashtags([]); setImageUrl(''); setCustomPrompt('')
    setContentType('image+text'); setScheduledAt(''); setError(''); setPublished(null)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      <StepIndicator current={step} />

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
      )}

      {/* Step 1 — Caption */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">What's your post about?</h2>

          <input
            type="text"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 placeholder-gray-400"
            placeholder="e.g. 'Morning routine tips'"
            value={topic}
            onChange={e => setTopic(e.target.value)}
          />

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Tone</p>
            <div className="flex flex-wrap gap-2">
              {TONES.map(t => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
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
            <input
              type="range"
              min={5}
              max={30}
              value={hashtagCount}
              onChange={e => setHashtagCount(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
          </div>

          <button
            onClick={generateCaption}
            disabled={!topic.trim() || loading}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition ${gradientBtn}`}
          >
            {loading ? <Spinner /> : null}
            ✨ Generate Caption
          </button>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">Caption</p>
            <textarea
              className="w-full h-40 px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 placeholder-gray-400"
              placeholder="Write your caption here, or generate one above…"
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
          </div>

          <div className="flex pt-1">
            <button
              onClick={() => setStep(2)}
              disabled={!caption.trim()}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition ${gradientBtn}`}
            >
              Next: Add Image →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Image */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Add an Image</h2>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <p className="text-[11px] font-medium text-gray-400 mb-1">Caption</p>
            <p className="text-xs text-gray-600 line-clamp-3 whitespace-pre-wrap">{caption}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1.5">Custom style (optional)</p>
            <textarea
              className="w-full h-20 px-3 py-2 border border-gray-200 rounded-xl text-xs resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400 placeholder-gray-400"
              placeholder="e.g. 'Warm tones, flat-lay, cozy aesthetic, no text'"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="space-y-3">
              <div className="aspect-square max-w-xs bg-gray-100 rounded-xl animate-pulse" />
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Spinner /> <span>Generating image… this can take up to 60 seconds</span>
              </div>
            </div>
          ) : imageUrl ? (
            <div className="space-y-3">
              <img src={imageUrl} alt="Generated" className="w-full max-w-xs aspect-square object-cover rounded-xl border border-gray-200" />
              <button
                onClick={generateImage}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-xs font-medium hover:bg-gray-200 transition"
              >
                Regenerate
              </button>
            </div>
          ) : (
            <button
              onClick={generateImage}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition ${gradientBtn}`}
            >
              Generate Image
            </button>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Back
            </button>
            <button
              onClick={() => { setContentType('text'); setStep(3) }}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
            >
              Skip — Text Only
            </button>
            <button
              onClick={() => { setContentType('image+text'); setStep(3) }}
              disabled={!imageUrl}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition ${gradientBtn}`}
            >
              Next: Preview →
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Preview & Post */}
      {step === 3 && (
        <div className="space-y-5">
          {published ? (
            <div className="space-y-5 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600">
                  <span className="text-3xl text-white">✓</span>
                </div>
                <h2 className="text-base font-semibold text-gray-900">
                  {published.scheduled_for ? `Scheduled for ${published.scheduled_for}` : 'Posted to Instagram!'}
                </h2>
                <span className="text-sm text-purple-600 font-medium">View on Instagram</span>
              </div>
              <div className="flex gap-2 justify-center pt-2">
                <button
                  onClick={onViewHistory}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
                >
                  View History
                </button>
                <button
                  onClick={reset}
                  className={`px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition ${gradientBtn}`}
                >
                  Create Another Post
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-gray-900">Preview & Post</h2>

              {/* Instagram-style preview card */}
              <div className="max-w-xs mx-auto">
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600" />
                    <span className="text-xs font-semibold">your_account</span>
                  </div>
                  {contentType === 'image+text' && imageUrl && (
                    <img src={imageUrl} className="w-full aspect-square object-cover" />
                  )}
                  <div className="px-3 py-2">
                    <p className="text-xs text-gray-800 whitespace-pre-wrap line-clamp-3">{caption}</p>
                    {hashtags.length > 0 && (
                      <p className="text-xs text-blue-500 mt-1">{hashtags.map(h => `#${h}`).join(' ')}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs font-medium text-gray-500">Schedule (optional)</p>
                <input
                  type="datetime-local"
                  className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                />
                <p className="text-[11px] text-gray-400">Leave empty to post immediately.</p>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(2)} className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                  Back
                </button>
                <button
                  onClick={publish}
                  disabled={loading}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition ${gradientBtn}`}
                >
                  {loading ? <Spinner /> : null}
                  {scheduledAt ? 'Schedule →' : 'Post Now →'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
