import { useEffect, useState } from 'react'
import { api } from '../../api/client'

type Signature = { id: number; name: string; content: string; is_default: number; account_id: number }

interface Props {
  show: boolean
  replyBody: string
  onBodyChange: (html: string) => void
}

export function ComposeSignaturePanel({ show, replyBody, onBodyChange }: Props) {
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [selectedSigId, setSelectedSigId] = useState<number | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!show) return
    api.getSignatures().then(({ signatures: sigs }) => {
      setSignatures(sigs)
      const def = sigs.find((s: Signature) => s.is_default)
      if (def) setSelectedSigId(def.id)
    }).catch(() => {})
  }, [show])

  const applySignature = (sigId: number | null) => {
    setSelectedSigId(sigId)
    if (sigId === null) return
    const sig = signatures.find(s => s.id === sigId)
    if (!sig) return
    const body = replyBody.replace(/\n\n--\n[\s\S]*$/, '')
    onBodyChange(body + '\n\n--\n' + sig.content)
  }

  const handleSave = async () => {
    if (!newName.trim() || !newContent.trim()) return
    setSaving(true)
    try {
      await api.createSignature({ name: newName.trim(), content: newContent.trim(), is_default: false })
      const { signatures: sigs } = await api.getSignatures()
      setSignatures(sigs)
      setNewName(''); setNewContent(''); setShowEditor(false)
    } catch { /* silent */ } finally { setSaving(false) }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.deleteSignature(id)
      setSignatures(prev => prev.filter(s => s.id !== id))
      if (selectedSigId === id) setSelectedSigId(null)
    } catch { /* silent */ }
  }

  return (
    <>
      {signatures.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 flex-shrink-0">Signature:</span>
          <select
            value={selectedSigId ?? ''}
            onChange={e => applySignature(e.target.value ? Number(e.target.value) : null)}
            className="text-[11px] border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">None</option>
            {signatures.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.is_default ? ' (default)' : ''}</option>
            ))}
          </select>
          <button onClick={() => setShowEditor(v => !v)} className="text-[10px] text-accent hover:underline flex-shrink-0">Manage</button>
        </div>
      )}
      {signatures.length === 0 && (
        <button onClick={() => setShowEditor(v => !v)} className="text-[10px] text-accent hover:underline">+ Add signature</button>
      )}
      {showEditor && (
        <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-2">
          <p className="text-[11px] font-medium text-gray-600">Signatures</p>
          {signatures.map(s => (
            <div key={s.id} className="flex items-center justify-between text-[11px] text-gray-600 border-b border-gray-100 pb-1">
              <span className="font-medium">{s.name}</span>
              <button onClick={() => handleDelete(s.id)} className="text-red-400 hover:text-red-600 text-[10px]">Delete</button>
            </div>
          ))}
          <div className="space-y-1 pt-1">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Signature name"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Signature content" rows={2}
              className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent resize-none bg-white" />
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving || !newName.trim() || !newContent.trim()}
                className="text-[10px] px-2 py-1 bg-accent text-white rounded hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setShowEditor(false); setNewName(''); setNewContent('') }}
                className="text-[10px] px-2 py-1 border border-gray-200 rounded text-gray-500 hover:bg-gray-50">Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
