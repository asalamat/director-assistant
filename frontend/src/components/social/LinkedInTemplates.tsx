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

/** Mini LinkedIn post card mockup — shows what the post will look like */
function PostMockup({ sampleImage, icon, name }: { sampleImage?: string; icon?: string; name: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm w-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          YN
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 leading-tight truncate">Your Name</p>
          <p className="text-[10px] text-gray-400 leading-tight">LinkedIn Post · Just now</p>
        </div>
      </div>
      {/* Body text lines (placeholder) */}
      <div className="px-3 pb-2 space-y-1">
        <div className="h-1.5 bg-gray-100 rounded-full w-full" />
        <div className="h-1.5 bg-gray-100 rounded-full w-5/6" />
        <div className="h-1.5 bg-gray-100 rounded-full w-2/3" />
      </div>
      {/* Image area */}
      <div className="relative bg-gray-50 aspect-video overflow-hidden">
        {sampleImage ? (
          <img src={sampleImage} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-3xl">{icon || '🎨'}</span>
            <p className="text-[9px] text-gray-400 text-center px-2 leading-tight">Upload a sample to preview here</p>
          </div>
        )}
      </div>
      {/* Reactions bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-gray-100">
        <span className="text-[9px] text-gray-400">👍 Like</span>
        <span className="text-[9px] text-gray-400">💬 Comment</span>
        <span className="text-[9px] text-gray-400">↗ Share</span>
      </div>
    </div>
  )
}

export function LinkedInTemplates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form state
  const [newName, setNewName] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newImage, setNewImage] = useState('')
  const [previewImage, setPreviewImage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    try {
      const r = await (api as any).getLinkedInTemplates()
      setTemplates(r.templates || [])
    } catch {
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
      setPreviewImage(b64)
    }
    reader.readAsDataURL(file)
  }

  const clearImage = () => {
    setNewImage('')
    setPreviewImage('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const save = async () => {
    if (!newName.trim() || !newPrompt.trim()) { setError('Name and prompt are required'); return }
    setSaving(true); setError(''); setSuccess('')
    try {
      await (api as any).saveLinkedInTemplate({ name: newName.trim(), prompt: newPrompt.trim(), sample_image: newImage })
      setNewName(''); setNewPrompt(''); clearImage()
      setSuccess('Template saved and ready to use in the wizard!')
      await load()
      setTimeout(() => setSuccess(''), 4000)
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
    <div className="flex flex-col h-full overflow-y-auto p-6 space-y-8 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-gray-900">📚 Prompt Template Library</h2>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          Each template defines an image style used when generating your LinkedIn post visuals.
          The <strong>sample image</strong> shows exactly what your post will look like — upload a reference photo
          or screenshot so you can compare styles at a glance while composing a post.
        </p>
      </div>

      {error && <div className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>}
      {success && <div className="px-4 py-2 bg-green-50 text-green-700 rounded-xl text-sm">{success}</div>}

      {/* Built-in templates */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Built-in Styles</p>
          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded-full">{builtin.length} styles</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {builtin.map(t => (
            <div key={t.id} className="border border-gray-200 rounded-2xl overflow-hidden bg-gray-50">
              {/* LinkedIn post mockup */}
              <div className="p-3">
                <PostMockup sampleImage={t.sample_image || undefined} icon={t.icon} name={t.name} />
              </div>
              {/* Template info */}
              <div className="px-4 pb-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{t.icon || '🎨'}</span>
                  <span className="font-semibold text-sm text-gray-900">{t.name}</span>
                  <span className="ml-auto px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded">Built-in</span>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">{t.prompt}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* User templates */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">My Templates</p>
          {user.length > 0 && (
            <span className="px-2 py-0.5 bg-green-50 text-green-600 text-[10px] font-medium rounded-full">{user.length} custom</span>
          )}
        </div>
        {user.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center">
            <span className="text-3xl">🎨</span>
            <p className="text-sm text-gray-500 mt-2">No custom templates yet</p>
            <p className="text-xs text-gray-400 mt-0.5">Add one below to use your own visual style</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {user.map(t => (
              <div key={t.id} className="border border-gray-200 rounded-2xl overflow-hidden bg-white group">
                <div className="p-3">
                  <PostMockup sampleImage={t.sample_image || undefined} name={t.name} />
                </div>
                <div className="px-4 pb-4 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-gray-900 flex-1">{t.name}</span>
                    <button
                      onClick={() => remove(t.id)}
                      className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-xs text-red-400 hover:bg-red-50 rounded transition"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">{t.prompt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add new template */}
      <section className="border-t border-gray-100 pt-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Add New Template</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Form fields */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">Style Name</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                placeholder="e.g. Dark & Dramatic"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">Image Prompt</label>
              <p className="text-[11px] text-gray-400 mb-1.5">Describe the visual style for DALL-E to use when generating your post image</p>
              <textarea
                className="w-full h-28 px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                placeholder="e.g. Dark moody photography, dramatic lighting, desaturated background with one vivid accent color, cinematic style, no text"
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Sample Image</label>
              <p className="text-[11px] text-gray-400 mb-2">
                Upload an example of what your post will look like — a reference photo, a DALL-E output you liked, or any visual that captures the style.
                This appears as the post preview so you can choose the right style at a glance.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="px-3 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:border-accent hover:text-accent transition"
                >
                  {previewImage ? 'Change image…' : 'Upload sample image…'}
                </button>
                {previewImage && (
                  <button onClick={clearImage} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </div>

            <button
              onClick={save}
              disabled={saving || !newName.trim() || !newPrompt.trim()}
              className="w-full px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>

          {/* Live preview */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1.5">Live Preview</label>
            <p className="text-[11px] text-gray-400 mb-2">This is how your template card will appear when choosing a style</p>
            <div className="border border-gray-200 rounded-2xl overflow-hidden bg-gray-50">
              <div className="p-3">
                <PostMockup sampleImage={previewImage || undefined} name={newName || 'My Style'} />
              </div>
              <div className="px-4 pb-4 space-y-1">
                <p className="font-semibold text-sm text-gray-900">{newName || <span className="text-gray-300">Style Name</span>}</p>
                <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">
                  {newPrompt || <span className="text-gray-300">Your prompt will appear here…</span>}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
