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

/** Mini LinkedIn post card mockup */
function PostMockup({ sampleImage, icon, name }: { sampleImage?: string; icon?: string; name: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm w-full">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          YN
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 leading-tight truncate">Your Name</p>
          <p className="text-[10px] text-gray-400 leading-tight">LinkedIn Post · Just now</p>
        </div>
      </div>
      <div className="px-3 pb-2 space-y-1">
        <div className="h-1.5 bg-gray-100 rounded-full w-full" />
        <div className="h-1.5 bg-gray-100 rounded-full w-5/6" />
        <div className="h-1.5 bg-gray-100 rounded-full w-2/3" />
      </div>
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
      <div className="flex items-center gap-3 px-3 py-2 border-t border-gray-100">
        <span className="text-[9px] text-gray-400">👍 Like</span>
        <span className="text-[9px] text-gray-400">💬 Comment</span>
        <span className="text-[9px] text-gray-400">↗ Share</span>
      </div>
    </div>
  )
}

interface AIImprovePanelProps {
  state: AIImproveState
  isBuiltin: boolean
  currentPrompt: string
  onChange: (v: string) => void
  onRun: () => void
  onAccept: () => void
  onClose: () => void
}

function AIImprovePanel({ state, isBuiltin, currentPrompt, onChange, onRun, onAccept, onClose }: AIImprovePanelProps) {
  return (
    <div className="mt-2 border border-purple-200 rounded-xl bg-purple-50/40 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-purple-700">✨ AI Prompt Improver</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
      </div>
      <div>
        <label className="text-[10px] text-gray-500 block mb-1">Instruction (optional)</label>
        <input
          type="text"
          placeholder="e.g. make it more minimalist, add warm tones, focus on people…"
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-300 bg-white"
          value={state.instruction}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onRun()}
        />
      </div>
      <button
        onClick={onRun}
        disabled={state.loading}
        className="w-full py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-50 transition"
      >
        {state.loading ? '⏳ Improving…' : '✨ Improve Prompt'}
      </button>
      {state.error && <p className="text-[11px] text-red-500">{state.error}</p>}
      {state.result && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Improved prompt</p>
          <p className="text-[11px] text-gray-800 leading-relaxed bg-white border border-purple-100 rounded-lg px-3 py-2">{state.result}</p>
          <div className="flex gap-2">
            <button
              onClick={onAccept}
              className="flex-1 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition"
            >
              {isBuiltin ? '+ Save as New Template' : '✓ Apply'}
            </button>
            <button
              onClick={() => onChange(state.instruction)}
              className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition"
            >
              Re-run
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface EditFormProps {
  template: Template
  onSave: (updated: Template) => void
  onCancel: () => void
}

function EditForm({ template, onSave, onCancel }: EditFormProps) {
  const [name, setName] = useState(template.name)
  const [prompt, setPrompt] = useState(template.prompt)
  const [image, setImage] = useState(template.sample_image || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setImage(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!name.trim() || !prompt.trim()) { setError('Name and prompt are required'); return }
    setSaving(true); setError('')
    try {
      const r = await fetch(`/api/social/linkedin/templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), prompt: prompt.trim(), sample_image: image }),
      })
      const data = await r.json()
      if (data.error) { setError(data.error); return }
      onSave({ ...template, name: name.trim(), prompt: prompt.trim(), sample_image: image })
    } catch (e) {
      setError((e as Error).message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-2 border-accent rounded-2xl p-4 bg-blue-50/30 space-y-3">
      <p className="text-xs font-semibold text-accent">Editing: {template.name}</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Style Name</label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Image Prompt</label>
        <p className="text-[11px] text-gray-400 mb-1.5">
          This prompt is sent directly to DALL-E combined with your post topic and content — describe the visual style.
        </p>
        <textarea
          className="w-full h-28 px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-700 block mb-1">Sample Image</label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:border-accent hover:text-accent transition"
          >
            {image ? 'Change image…' : 'Upload sample…'}
          </button>
          {image && (
            <button onClick={() => setImage('')} className="text-xs text-red-400 hover:text-red-600">Remove</button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        {image && (
          <img src={image} alt="preview" className="mt-2 h-20 rounded-lg object-cover border border-gray-200" />
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || !name.trim() || !prompt.trim()}
          className="px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

interface AIImproveState {
  id: string
  instruction: string
  loading: boolean
  result: string
  error: string
}

export function LinkedInTemplates() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [aiImprove, setAiImprove] = useState<AIImproveState | null>(null)

  // New template form state
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
      setSuccess('Template saved!')
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

  const handleEditSave = (updated: Template) => {
    setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t))
    setEditingId(null)
    setSuccess('Template updated!')
    setTimeout(() => setSuccess(''), 3000)
  }

  const openAI = (t: Template) =>
    setAiImprove({ id: t.id, instruction: '', loading: false, result: '', error: '' })

  const runImprove = async (currentPrompt: string) => {
    if (!aiImprove) return
    setAiImprove(s => s ? { ...s, loading: true, result: '', error: '' } : s)
    try {
      const r = await fetch('/api/social/linkedin/templates/improve-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: currentPrompt, instruction: aiImprove.instruction }),
      })
      const data = await r.json()
      if (data.error) setAiImprove(s => s ? { ...s, loading: false, error: data.error } : s)
      else setAiImprove(s => s ? { ...s, loading: false, result: data.improved_prompt } : s)
    } catch (e) {
      setAiImprove(s => s ? { ...s, loading: false, error: (e as Error).message } : s)
    }
  }

  const acceptImproved = async (templateId: string, isBuiltin: boolean) => {
    if (!aiImprove?.result) return
    if (isBuiltin) {
      // For built-in templates, pre-fill the new template form with the improved prompt
      const tmpl = templates.find(t => t.id === templateId)
      setNewName(tmpl ? `${tmpl.name} (Custom)` : '')
      setNewPrompt(aiImprove.result)
      setAiImprove(null)
      document.getElementById('add-template-section')?.scrollIntoView({ behavior: 'smooth' })
      setSuccess('Improved prompt copied to new template form below ↓')
      setTimeout(() => setSuccess(''), 4000)
    } else {
      // For user templates, update in-place
      const tmpl = templates.find(t => t.id === templateId)
      if (!tmpl) return
      const r = await fetch(`/api/social/linkedin/templates/${templateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tmpl.name, prompt: aiImprove.result, sample_image: tmpl.sample_image }),
      })
      const data = await r.json()
      if (!data.error) {
        setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, prompt: aiImprove.result } : t))
        setSuccess('Prompt updated!')
        setTimeout(() => setSuccess(''), 3000)
      }
      setAiImprove(null)
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
          Each template defines an image style. When you select one in the wizard, your template prompt
          is sent <strong>directly to DALL-E combined with your post topic and content</strong> — no AI rewrite in between.
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
              <div className="p-3">
                <PostMockup sampleImage={t.sample_image || undefined} icon={t.icon} name={t.name} />
              </div>
              <div className="px-4 pb-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{t.icon || '🎨'}</span>
                  <span className="font-semibold text-sm text-gray-900">{t.name}</span>
                  <span className="ml-auto px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded">Built-in</span>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-3">{t.prompt}</p>
                <button
                  onClick={() => aiImprove?.id === t.id ? setAiImprove(null) : openAI(t)}
                  className="flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-800 font-medium mt-1"
                >
                  ✨ AI Improve
                </button>
                {aiImprove?.id === t.id && (
                  <AIImprovePanel
                    state={aiImprove}
                    isBuiltin
                    currentPrompt={t.prompt}
                    onChange={v => setAiImprove(s => s ? { ...s, instruction: v } : s)}
                    onRun={() => runImprove(t.prompt)}
                    onAccept={() => acceptImproved(t.id, true)}
                    onClose={() => setAiImprove(null)}
                  />
                )}
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
          <div className="space-y-4">
            {user.map(t => (
              <div key={t.id}>
                {editingId === t.id ? (
                  <EditForm
                    template={t}
                    onSave={handleEditSave}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white group">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
                      <div className="p-3 border-b sm:border-b-0 sm:border-r border-gray-100">
                        <PostMockup sampleImage={t.sample_image || undefined} name={t.name} />
                      </div>
                      <div className="px-4 py-4 flex flex-col gap-2">
                        <div className="flex items-start gap-2">
                          <span className="font-semibold text-sm text-gray-900 flex-1">{t.name}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 leading-relaxed flex-1">{t.prompt}</p>
                        <div className="flex gap-2 mt-auto pt-2 flex-wrap">
                          <button
                            onClick={() => setEditingId(t.id)}
                            className="px-3 py-1.5 text-xs font-medium text-accent border border-accent rounded-lg hover:bg-blue-50 transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => aiImprove?.id === t.id ? setAiImprove(null) : openAI(t)}
                            className="px-3 py-1.5 text-xs font-medium text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition"
                          >
                            ✨ AI
                          </button>
                          <button
                            onClick={() => remove(t.id)}
                            className="px-3 py-1.5 text-xs text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition"
                          >
                            Delete
                          </button>
                        </div>
                        {aiImprove?.id === t.id && (
                          <AIImprovePanel
                            state={aiImprove}
                            isBuiltin={false}
                            currentPrompt={t.prompt}
                            onChange={v => setAiImprove(s => s ? { ...s, instruction: v } : s)}
                            onRun={() => runImprove(t.prompt)}
                            onAccept={() => acceptImproved(t.id, false)}
                            onClose={() => setAiImprove(null)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add new template */}
      <section id="add-template-section" className="border-t border-gray-100 pt-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Add New Template</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
              <p className="text-[11px] text-gray-400 mb-1.5">
                Sent directly to DALL-E with your post topic appended. Describe the visual style.
              </p>
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
                Upload a reference photo so you can compare styles at a glance in the wizard.
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

          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1.5">Live Preview</label>
            <p className="text-[11px] text-gray-400 mb-2">How this template card will appear when choosing a style</p>
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
