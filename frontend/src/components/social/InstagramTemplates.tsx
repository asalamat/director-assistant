import { useState, useEffect } from 'react'
import { api } from '../../api/client'

interface Template {
  id: string
  name: string
  icon: string
  tone: string
  prompt: string
  sample_image: string
  builtin: number
}

const TONES = ['Inspiring', 'Educational', 'Behind-the-scenes', 'Promotional', 'Personal']
const gradient = 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600'

function TemplateMockup({ sampleImage, icon, name }: { sampleImage?: string; icon?: string; name: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm w-full">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className={`w-8 h-8 rounded-full ${gradient} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>IG</div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 leading-tight truncate">your_account</p>
          <p className="text-[10px] text-gray-400 leading-tight">Just now</p>
        </div>
      </div>
      <div className="relative bg-gray-100 aspect-square overflow-hidden">
        {sampleImage ? (
          <img src={sampleImage} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-4xl">{icon || '📸'}</span>
            <p className="text-[9px] text-gray-400 text-center px-2 leading-tight">Upload a sample image</p>
          </div>
        )}
      </div>
      <div className="px-3 py-2 space-y-1">
        <div className="h-1.5 bg-gray-100 rounded-full w-full" />
        <div className="h-1.5 bg-gray-100 rounded-full w-4/5" />
        <div className="h-1.5 bg-gray-100 rounded-full w-2/3" />
      </div>
    </div>
  )
}

export function InstagramTemplates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Template | null>(null)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [fName, setFName] = useState('')
  const [fIcon, setFIcon] = useState('📸')
  const [fTone, setFTone] = useState('Inspiring')
  const [fPrompt, setFPrompt] = useState('')
  const [fSampleImage, setFSampleImage] = useState('')

  useEffect(() => { loadTemplates() }, [])

  const loadTemplates = () => {
    setLoading(true)
    ;(api as any).getInstagramTemplates()
      .then((r: any) => { setTemplates(r.templates || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  const select = (t: Template) => {
    setSelected(t); setEditing(false); setCreating(false)
    setFName(t.name); setFIcon(t.icon || '📸'); setFTone(t.tone || 'Inspiring')
    setFPrompt(t.prompt); setFSampleImage(t.sample_image || '')
  }

  const startCreate = () => {
    setSelected(null); setCreating(true); setEditing(false)
    setFName(''); setFIcon('📸'); setFTone('Inspiring'); setFPrompt(''); setFSampleImage('')
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setFSampleImage(ev.target?.result as string || '')
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!fName.trim() || !fPrompt.trim()) { setError('Name and prompt are required'); return }
    setSaving(true); setError('')
    try {
      if (creating) {
        await (api as any).saveInstagramTemplate({ name: fName, icon: fIcon, tone: fTone, prompt: fPrompt, sample_image: fSampleImage })
      } else if (selected && !selected.builtin) {
        await (api as any).updateInstagramTemplate(selected.id, { name: fName, icon: fIcon, tone: fTone, prompt: fPrompt, sample_image: fSampleImage || null })
      }
      loadTemplates(); setCreating(false); setEditing(false)
      setSelected(null)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  const handleDelete = async (t: Template) => {
    if (!confirm(`Delete template "${t.name}"?`)) return
    await (api as any).deleteInstagramTemplate(t.id)
    if (selected?.id === t.id) setSelected(null)
    loadTemplates()
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  const showForm = editing || creating

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left — template list */}
      <div className="w-52 flex-shrink-0 border-r border-gray-100 flex flex-col bg-gray-50">
        <div className="px-3 pt-4 pb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Templates</p>
          <button onClick={startCreate}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium text-white ${gradient}`}>
            + New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {templates.map(t => (
            <button key={t.id} onClick={() => select(t)}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                selected?.id === t.id ? 'bg-white border border-pink-200 shadow-sm' : 'hover:bg-white'
              }`}>
              <div className="flex items-center gap-2">
                <span className="text-base">{t.icon || '📸'}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-900 truncate">{t.name}</p>
                  <p className="text-[10px] text-gray-400">{t.builtin ? 'Built-in' : 'Custom'} · {t.tone}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right — detail / form */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected && !showForm && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-3">
            <span className="text-4xl">📸</span>
            <p className="text-sm">Select a template to preview<br />or create a new one.</p>
            <button onClick={startCreate}
              className={`px-4 py-2 rounded-xl text-sm font-medium text-white ${gradient}`}>
              + Create Template
            </button>
          </div>
        )}

        {selected && !showForm && (
          <div className="max-w-md space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <span>{selected.icon}</span>{selected.name}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Tone: {selected.tone} · {selected.builtin ? 'Built-in' : 'Custom'}</p>
              </div>
              {!selected.builtin && (
                <div className="flex gap-2">
                  <button onClick={() => setEditing(true)}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(selected)}
                    className="px-3 py-1.5 text-xs font-medium text-red-500 border border-red-100 rounded-lg hover:bg-red-50 transition">
                    Delete
                  </button>
                </div>
              )}
            </div>

            <TemplateMockup sampleImage={selected.sample_image} icon={selected.icon} name={selected.name} />

            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Caption Style Prompt</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{selected.prompt}</p>
            </div>
          </div>
        )}

        {showForm && (
          <div className="max-w-md space-y-4">
            <h2 className="text-base font-semibold text-gray-900">
              {creating ? 'New Template' : `Edit: ${selected?.name}`}
            </h2>

            {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Icon</label>
                <input type="text" value={fIcon} onChange={e => setFIcon(e.target.value)}
                  maxLength={2}
                  className="w-full text-center text-lg border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300" />
              </div>
              <div className="col-span-3">
                <label className="text-xs font-medium text-gray-600 block mb-1">Name</label>
                <input type="text" value={fName} onChange={e => setFName(e.target.value)}
                  placeholder="e.g. Product Launch"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1.5">Default Tone</label>
              <div className="flex flex-wrap gap-2">
                {TONES.map(t => (
                  <button key={t} onClick={() => setFTone(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      fTone === t ? `${gradient} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>{t}</button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Caption Style Prompt</label>
              <textarea rows={5} value={fPrompt} onChange={e => setFPrompt(e.target.value)}
                placeholder="e.g. Write a short motivational caption that starts with a bold statement…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none" />
              <p className="text-[11px] text-gray-400 mt-1">This prompt is prepended when AI generates captions using this template.</p>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Sample Image (optional)</label>
              <div className="flex items-center gap-3">
                {fSampleImage && (
                  <img src={fSampleImage} className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                )}
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-pink-400 transition text-xs text-gray-500">
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  {fSampleImage ? 'Replace image' : 'Upload preview image'}
                </label>
                {fSampleImage && (
                  <button onClick={() => setFSampleImage('')} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={handleSave} disabled={saving}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium text-white ${gradient} hover:opacity-90 disabled:opacity-50 transition`}>
                {saving ? 'Saving…' : creating ? 'Create Template' : 'Save Changes'}
              </button>
              <button onClick={() => { setEditing(false); setCreating(false) }}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
