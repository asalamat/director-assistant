import { useState, useEffect, useRef } from 'react'
import { api } from '../../api/client'

interface Template {
  id: string
  name: string
  prompt: string
  sample_image: string
  builtin: number
  icon?: string
}

export function LinkedInTemplates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newName, setNewName] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newImage, setNewImage] = useState('')
  const [preview, setPreview] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    try {
      const r = await (api as any).getLinkedInTemplates()
      setTemplates(r.templates || [])
    } catch (e) {
      setError('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const b64 = ev.target?.result as string
      setNewImage(b64)
      setPreview(b64)
    }
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!newName.trim() || !newPrompt.trim()) {
      setError('Name and prompt are required')
      return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      await (api as any).saveLinkedInTemplate({ name: newName.trim(), prompt: newPrompt.trim(), sample_image: newImage })
      setNewName(''); setNewPrompt(''); setNewImage(''); setPreview('')
      if (fileRef.current) fileRef.current.value = ''
      setSuccess('Template saved!')
      await load()
      setTimeout(() => setSuccess(''), 3000)
    } catch (e) {
      setError((e as Error).message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await (api as any).deleteLinkedInTemplate(id)
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch {
      setError('Delete failed')
    }
  }

  const builtin = templates.filter(t => t.builtin)
  const user = templates.filter(t => !t.builtin)

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading templates…</div>

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">📚 Prompt Template Library</h2>
        <p className="text-xs text-gray-500 mt-0.5">Pre-built and custom styles that guide DALL-E image generation. Select one during the wizard to apply it.</p>
      </div>

      {error && <div className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>}
      {success && <div className="px-4 py-2 bg-green-50 text-green-700 rounded-xl text-sm">{success}</div>}

      {/* Built-in */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Built-in Styles</p>
        <div className="grid grid-cols-2 gap-3">
          {builtin.map(t => (
            <div key={t.id} className="border border-gray-200 rounded-xl p-3 flex gap-3 items-start">
              {t.sample_image ? (
                <img src={t.sample_image} alt={t.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center text-2xl flex-shrink-0">{t.icon || '🎨'}</div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-900">{t.name}</span>
                  <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">Built-in</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{t.prompt}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* User templates */}
      <section>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">My Templates</p>
        {user.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No custom templates yet. Add one below.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {user.map(t => (
              <div key={t.id} className="border border-gray-200 rounded-xl p-3 flex gap-3 items-start group">
                {t.sample_image ? (
                  <img src={t.sample_image} alt={t.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center text-2xl flex-shrink-0">🎨</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-sm font-medium text-gray-900">{t.name}</span>
                    <button
                      onClick={() => remove(t.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-red-400 transition"
                      title="Delete"
                    >✕</button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{t.prompt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add new */}
      <section className="border-t border-gray-100 pt-5 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Add New Template</p>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Name</label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            placeholder="e.g. Dark & Dramatic"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Prompt</label>
          <textarea
            className="w-full h-24 px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            placeholder="Describe the visual style DALL-E should use (e.g. 'Dark moody photography, dramatic lighting…')"
            value={newPrompt}
            onChange={e => setNewPrompt(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Sample Image <span className="text-gray-400 font-normal">(optional — shown as preview during wizard)</span></label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-3 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:border-accent hover:text-accent transition"
            >
              Upload image…
            </button>
            {preview && (
              <div className="relative">
                <img src={preview} alt="preview" className="w-12 h-12 rounded-lg object-cover" />
                <button
                  onClick={() => { setNewImage(''); setPreview(''); if (fileRef.current) fileRef.current.value = '' }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 text-white rounded-full text-[10px] flex items-center justify-center"
                >✕</button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </div>

        <button
          onClick={save}
          disabled={saving || !newName.trim() || !newPrompt.trim()}
          className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
        >
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </section>
    </div>
  )
}
