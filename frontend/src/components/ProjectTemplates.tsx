import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { Spinner } from './ui'

interface Template {
  id: number
  name: string
  created_at: string
  task_count: number
}

interface Props {
  onCreated: (projectId: number, projectName: string) => void
}

export function ProjectTemplates({ onCreated }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [activeId, setActiveId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getProjectTemplates()
      .then(r => setTemplates(r.templates))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }, [])

  const handleUse = async (templateId: number) => {
    if (!newName.trim()) return
    setCreating(templateId)
    setError('')
    try {
      const r = await api.createProjectFromTemplate(templateId, { name: newName.trim() })
      setNewName('')
      setActiveId(null)
      onCreated(r.id, r.name)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create project')
    } finally {
      setCreating(null)
    }
  }

  if (loading) return <div className="flex justify-center py-4"><Spinner size="sm" /></div>
  if (templates.length === 0) return null

  return (
    <div className="mb-3">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Start from Template</p>
      <div className="space-y-1.5">
        {templates.map(t => (
          <div key={t.id} className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors text-left"
              onClick={() => { setActiveId(activeId === t.id ? null : t.id); setNewName(''); setError('') }}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{t.name}</p>
                <p className="text-[10px] text-gray-400">{t.task_count} task{t.task_count !== 1 ? 's' : ''}</p>
              </div>
              <span className="text-[10px] text-accent font-medium ml-2 flex-shrink-0">Use</span>
            </button>
            {activeId === t.id && (
              <div className="px-3 pb-3 space-y-2 bg-blue-50 border-t border-blue-100">
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleUse(t.id) }}
                  placeholder="New project name…"
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 mt-2 focus:outline-none focus:ring-1 focus:ring-accent bg-white"
                />
                {error && <p className="text-[10px] text-red-500">{error}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setActiveId(null)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
                  <button
                    onClick={() => handleUse(t.id)}
                    disabled={!newName.trim() || creating === t.id}
                    className="text-xs bg-accent text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creating === t.id ? '…' : 'Create'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
