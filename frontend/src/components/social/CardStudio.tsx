import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import { addToast } from '../Toast'

type CardType = 'quote' | 'tip' | 'stat' | 'announcement'
type Tone = 'professional' | 'casual' | 'inspirational'

const CARD_TYPES: { id: CardType; icon: string; label: string }[] = [
  { id: 'quote', icon: '💬', label: 'Quote' },
  { id: 'tip', icon: '💡', label: 'Tip List' },
  { id: 'stat', icon: '📊', label: 'Stat' },
  { id: 'announcement', icon: '📣', label: 'Announcement' },
]

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200'

export function CardStudio() {
  const [cardType, setCardType] = useState<CardType>('quote')
  const [content, setContent] = useState<Record<string, any>>({})
  const [brand, setBrand] = useState({ primary_color: '#1e3a5f', accent_color: '#e8b84b', text_color: '#ffffff', bg_style: 'gradient', logo_url: '', author_name: '', tagline: '' })
  const [generating, setGenerating] = useState(false)
  const [cardImage, setCardImage] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [tone, setTone] = useState<Tone>('professional')
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(['linkedin']))
  const [posting, setPosting] = useState(false)
  const [postResults, setPostResults] = useState<{ platform: string; status: string; error?: string }[] | null>(null)
  const [brandOpen, setBrandOpen] = useState(false)
  const [brandSaving, setBrandSaving] = useState(false)

  useEffect(() => {
    api.getBrandKit().then(kit => setBrand(kit)).catch(() => {})
  }, [])

  const setField = (key: string, value: any) => setContent(prev => ({ ...prev, [key]: value }))

  const fetchCaption = async () => {
    try {
      const r = await api.generateCardCaption({ card_type: cardType, content, platform: [...platforms][0] || 'linkedin', tone })
      setCaption(r.caption)
      setHashtags(r.hashtags || [])
    } catch (e) {
      addToast((e as Error).message, 'warning')
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setPostResults(null)
    try {
      const r = await api.generateCard({ card_type: cardType, content, brand })
      setCardImage(r.image_b64)
      await fetchCaption()
    } catch (e) {
      addToast((e as Error).message, 'warning')
    } finally {
      setGenerating(false)
    }
  }

  const togglePlatform = (p: string) => {
    setPlatforms(prev => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  const handlePost = async () => {
    if (!cardImage) return
    if (platforms.size === 0) { addToast('Select at least one platform', 'warning'); return }
    setPosting(true)
    setPostResults(null)
    try {
      const r = await api.postCard({ image_b64: cardImage, caption, hashtags, platforms: [...platforms] })
      setPostResults(r.results)
    } catch (e) {
      addToast((e as Error).message, 'warning')
    } finally {
      setPosting(false)
    }
  }

  const saveBrand = async () => {
    setBrandSaving(true)
    try {
      await api.saveBrandKit(brand)
      addToast('Brand kit saved', 'success')
    } catch (e) {
      addToast((e as Error).message, 'warning')
    } finally {
      setBrandSaving(false)
    }
  }

  const items: string[] = content.items || []

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-72 flex-shrink-0 border-r border-gray-100 overflow-y-auto p-4 space-y-4 bg-gray-50">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Card Type</p>
          <div className="grid grid-cols-2 gap-2">
            {CARD_TYPES.map(t => (
              <button key={t.id} onClick={() => { setCardType(t.id); setContent({}) }}
                className={`flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${cardType === t.id ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                <span>{t.icon}</span><span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Content</p>

          {cardType === 'quote' && (
            <>
              <textarea className={inputCls} rows={3} placeholder="Quote text" value={content.quote || ''} onChange={e => setField('quote', e.target.value)} />
              <input className={inputCls} placeholder="Author" value={content.author || ''} onChange={e => setField('author', e.target.value)} />
            </>
          )}

          {cardType === 'tip' && (
            <>
              <input className={inputCls} placeholder="Title" value={content.headline || ''} onChange={e => setField('headline', e.target.value)} />
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input className={inputCls} placeholder={`Tip ${i + 1}`} value={it} onChange={e => {
                    const next = [...items]; next[i] = e.target.value; setField('items', next)
                  }} />
                  <button onClick={() => setField('items', items.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-sm px-1">✕</button>
                </div>
              ))}
              {items.length < 5 && (
                <button onClick={() => setField('items', [...items, ''])} className="text-xs font-medium text-purple-600 hover:text-purple-800">+ Add tip</button>
              )}
            </>
          )}

          {cardType === 'stat' && (
            <>
              <input className={inputCls} placeholder="Big number, e.g. 87%" value={content.stat_number || ''} onChange={e => setField('stat_number', e.target.value)} />
              <textarea className={inputCls} rows={2} placeholder="Context text" value={content.body || ''} onChange={e => setField('body', e.target.value)} />
              <input className={inputCls} placeholder="Sub-headline (optional)" value={content.headline || ''} onChange={e => setField('headline', e.target.value)} />
            </>
          )}

          {cardType === 'announcement' && (
            <>
              <input className={inputCls} placeholder="Headline" value={content.headline || ''} onChange={e => setField('headline', e.target.value)} />
              <textarea className={inputCls} rows={3} placeholder="Body text" value={content.body || ''} onChange={e => setField('body', e.target.value)} />
            </>
          )}
        </div>

        <button onClick={handleGenerate} disabled={generating}
          className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {generating ? 'Generating…' : 'Generate Card'}
        </button>

        {/* Brand Kit */}
        <div className="border-t border-gray-200 pt-3">
          <button onClick={() => setBrandOpen(o => !o)} className="flex items-center justify-between w-full text-xs font-semibold text-gray-400 uppercase tracking-wider">
            <span>Brand Kit</span><span>{brandOpen ? '▲' : '▼'}</span>
          </button>
          {brandOpen && (
            <div className="space-y-2 mt-3">
              {([['primary_color', 'Primary'], ['accent_color', 'Accent'], ['text_color', 'Text']] as [keyof typeof brand, string][]).map(([k, label]) => (
                <label key={k} className="flex items-center justify-between text-xs text-gray-600">
                  <span>{label}</span>
                  <input type="color" value={brand[k]} onChange={e => setBrand(b => ({ ...b, [k]: e.target.value }))} className="h-7 w-12 rounded border border-gray-200" />
                </label>
              ))}
              <label className="block text-xs text-gray-600">Background style
                <select className={inputCls} value={brand.bg_style} onChange={e => setBrand(b => ({ ...b, bg_style: e.target.value }))}>
                  <option value="gradient">Gradient</option>
                  <option value="solid">Solid</option>
                </select>
              </label>
              <input className={inputCls} placeholder="Author name" value={brand.author_name} onChange={e => setBrand(b => ({ ...b, author_name: e.target.value }))} />
              <input className={inputCls} placeholder="Tagline" value={brand.tagline} onChange={e => setBrand(b => ({ ...b, tagline: e.target.value }))} />
              <input className={inputCls} placeholder="Logo URL" value={brand.logo_url} onChange={e => setBrand(b => ({ ...b, logo_url: e.target.value }))} />
              <button onClick={saveBrand} disabled={brandSaving}
                className="w-full px-3 py-2 bg-gray-800 text-white text-xs font-medium rounded-lg hover:bg-gray-900 disabled:opacity-50">
                {brandSaving ? 'Saving…' : 'Save Brand Kit'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {!cardImage ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <span className="text-5xl mb-3">🎨</span>
            <p className="text-sm">Fill in your card details and click Generate Card</p>
          </div>
        ) : (
          <div className="max-w-md mx-auto space-y-4">
            <img src={cardImage} className="w-full max-w-sm mx-auto rounded-xl shadow-lg" />

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Tone</p>
              <div className="flex gap-2">
                {(['professional', 'casual', 'inspirational'] as Tone[]).map(t => (
                  <button key={t} onClick={() => { setTone(t); fetchCaption() }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize border transition-colors ${tone === t ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Platforms</p>
              <div className="flex gap-4 text-sm text-gray-700">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={platforms.has('linkedin')} onChange={() => togglePlatform('linkedin')} /> LinkedIn
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={platforms.has('instagram')} onChange={() => togglePlatform('instagram')} /> Instagram
                </label>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Caption</p>
              <textarea className={inputCls} rows={4} value={caption} onChange={e => setCaption(e.target.value)} />
            </div>

            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {hashtags.map((h, i) => (
                  <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full">#{h.replace(/^#/, '')}</span>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={fetchCaption} className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
                Regenerate Caption
              </button>
              <button onClick={handlePost} disabled={posting}
                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {posting ? 'Posting…' : 'Post to Selected Platforms'}
              </button>
            </div>

            {postResults && (
              <div className="space-y-1.5">
                {postResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="capitalize text-gray-700 w-20">{r.platform}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${r.status === 'success' || r.status === 'posted' ? 'bg-green-100 text-green-700' : r.status === 'manual' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                      {r.status}
                    </span>
                    {r.error && <span className="text-xs text-red-500">{r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
