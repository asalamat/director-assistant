import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { Spinner } from './ui'

interface Milestone {
  id: number
  name: string
  due_date: string
  status: 'pending' | 'done'
  days_until: number | null
}

interface ProjectMilestonesProps {
  projectId: number
}

export function ProjectMilestones({ projectId }: ProjectMilestonesProps) {
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDate, setNewDate] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.getMilestones(projectId)
      .then(r => setMilestones(r.milestones as Milestone[]))
      .catch(() => setMilestones([]))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!newName.trim() || !newDate) return
    setSaving(true)
    try {
      await api.addMilestone(projectId, { name: newName.trim(), due_date: newDate })
      setNewName(''); setNewDate(''); setShowForm(false)
      load()
    } catch { /* silent */ }
    setSaving(false)
  }

  const handleToggle = async (m: Milestone) => {
    const next = m.status === 'done' ? 'pending' : 'done'
    setMilestones(prev => prev.map(x => x.id === m.id ? { ...x, status: next } : x))
    await api.updateMilestone(projectId, m.id, { status: next }).catch(() => load())
  }

  const handleDelete = async (id: number) => {
    setMilestones(prev => prev.filter(m => m.id !== id))
    await api.deleteMilestone(projectId, id).catch(() => load())
  }

  function chipStyle(m: Milestone): string {
    if (m.status === 'done') return 'bg-green-50 border-green-200 text-green-700'
    if (m.days_until !== null && m.days_until < 0) return 'bg-red-50 border-red-200 text-red-700'
    if (m.days_until !== null && m.days_until <= 3) return 'bg-amber-50 border-amber-200 text-amber-700'
    return 'bg-white border-gray-200 text-gray-700'
  }

  function dateLabel(m: Milestone): string {
    const parts = [m.due_date.slice(5)]  // MM-DD
    if (m.status === 'done') return `${m.due_date.slice(5)} ✓`
    if (m.days_until === null) return m.due_date.slice(5)
    if (m.days_until < 0) return `${m.due_date.slice(5)} (${Math.abs(m.days_until)}d overdue)`
    if (m.days_until === 0) return `${m.due_date.slice(5)} (today)`
    return `${m.due_date.slice(5)} (${m.days_until}d)`
  }

  return (
    <div className="pt-2 border-t border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-700">Milestones</p>
        <button onClick={() => setShowForm(v => !v)}
          className="text-xs text-accent hover:underline">
          {showForm ? 'Cancel' : '+ Add Milestone'}
        </button>
      </div>

      {loading && <div className="flex justify-center py-2"><Spinner size="sm" /></div>}

      {!loading && milestones.length === 0 && !showForm && (
        <p className="text-xs text-gray-400 italic">No milestones yet — add one to track key dates.</p>
      )}

      {/* Timeline chips */}
      <div className="flex flex-col gap-1.5">
        {milestones.map(m => (
          <div key={m.id}
            className={`flex items-center gap-2 border rounded-lg px-2.5 py-1.5 group ${chipStyle(m)}`}>
            <button onClick={() => handleToggle(m)} className="flex-shrink-0 text-sm" title="Toggle done">
              {m.status === 'done' ? '✅' : m.days_until !== null && m.days_until < 0 ? '⚠️' : '🎯'}
            </button>
            <span className="flex-1 min-w-0 text-xs font-medium truncate">{m.name}</span>
            <span className="text-[10px] flex-shrink-0 opacity-70">{dateLabel(m)}</span>
            <button onClick={() => handleDelete(m.id)}
              className="text-[10px] opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-opacity flex-shrink-0">
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Inline add form */}
      {showForm && (
        <div className="mt-2 flex gap-2 items-end flex-wrap">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Milestone name"
            className="flex-1 min-w-[120px] text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button onClick={handleAdd} disabled={saving || !newName.trim() || !newDate}
            className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex-shrink-0">
            {saving ? '…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  )
}
