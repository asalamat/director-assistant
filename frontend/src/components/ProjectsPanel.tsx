import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { EmptyState, Spinner, Button } from './ui'

interface Project { id: number; name: string; description: string; status: string; email_count: number; created_at: string }

const STATUS_COLORS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  paused:   'bg-amber-100 text-amber-700',
  resolved: 'bg-gray-100 text-gray-500',
}

export function ProjectsPanel({ onSelectEmail }: { onSelectEmail?: (emailId: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Project | null>(null)
  const [projEmails, setProjEmails] = useState<any[]>([])
  const [emailsLoading, setEmailsLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'resolved'>('all')

  const load = () => {
    setLoading(true)
    api.getProjects().then(r => setProjects(r.projects)).catch(() => setProjects([])).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await api.createProject({ name: newName.trim(), description: newDesc.trim(), status: 'active' })
      setNewName(''); setNewDesc(''); setShowCreate(false); load()
    } catch { /* silent */ }
    setSaving(false)
  }

  const openProject = async (proj: Project) => {
    setSelected(proj)
    setEmailsLoading(true)
    const r = await api.getProjectEmails(proj.id).catch(() => ({ emails: [] }))
    setProjEmails(r.emails)
    setEmailsLoading(false)
  }

  const cycleStatus = async (proj: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = proj.status === 'active' ? 'paused' : proj.status === 'paused' ? 'resolved' : 'active'
    await api.updateProject(proj.id, { status: next })
    setProjects(prev => prev.map(p => p.id === proj.id ? { ...p, status: next } : p))
    if (selected?.id === proj.id) setSelected(prev => prev ? { ...prev, status: next } : null)
  }

  const deleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this project?')) return
    await api.deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const unlinkEmail = async (emailId: string) => {
    if (!selected) return
    await api.unlinkEmailFromProject(selected.id, emailId)
    setProjEmails(prev => prev.filter(e => e.id !== emailId))
    setProjects(prev => prev.map(p => p.id === selected.id ? { ...p, email_count: Math.max(0, p.email_count - 1) } : p))
  }

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 text-xs">← Back</button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-800 truncate">{selected.name}</h2>
            {selected.description && <p className="text-xs text-gray-400 truncate">{selected.description}</p>}
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[selected.status] || STATUS_COLORS.active}`}>
            {selected.status}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {emailsLoading && <div className="flex justify-center py-8"><Spinner size="md" /></div>}
          {!emailsLoading && projEmails.length === 0 && (
            <div className="py-8">
              <EmptyState icon="📎" title="No emails linked yet" description="Open an email and use the project linker to add emails here." />
            </div>
          )}
          {projEmails.map(e => (
            <div key={e.id} className={`border rounded-xl p-3 flex gap-3 hover:border-accent transition-colors cursor-pointer group ${!e.is_read ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}
              onClick={() => onSelectEmail?.(e.id)}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{e.subject || '(no subject)'}</p>
                <p className="text-xs text-gray-500 truncate">{e.sender}</p>
                <p className="text-xs text-gray-400">{(e.date || '').slice(0, 10)} · {e.folder}</p>
              </div>
              <button onClick={(ev) => { ev.stopPropagation(); unlinkEmail(e.id) }}
                className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1 flex-shrink-0"
                title="Unlink from project">✕</button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Projects</h2>
          <p className="text-xs text-gray-400 mt-0.5">Link emails to deals and initiatives</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(v => !v)}>+ New</Button>
      </div>

      {showCreate && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex-shrink-0 space-y-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Project name *"
            className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white" autoFocus />
          <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)"
            className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
            <Button variant="primary" size="sm" loading={saving} onClick={create} disabled={saving || !newName.trim()}>Create</Button>
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b border-gray-50 flex gap-1 flex-shrink-0">
        {(['all', 'active', 'paused', 'resolved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === f ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({(f === 'all' ? projects : projects.filter(p => p.status === f)).length})
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex justify-center py-12"><Spinner size="md" /></div>}
        {!loading && filtered.length === 0 && (
          <div className="py-12">
            <EmptyState
              icon="📁"
              title="No projects yet"
              description="Create a project to link related emails together"
            />
          </div>
        )}
        {filtered.map(proj => (
          <div key={proj.id} onClick={() => openProject(proj)}
            className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer group transition-colors">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0 text-accent text-sm font-bold">
                {proj.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{proj.name}</p>
                  <button onClick={e => cycleStatus(proj, e)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 hover:opacity-80 transition-opacity ${STATUS_COLORS[proj.status] || STATUS_COLORS.active}`}
                    title="Click to cycle status">
                    {proj.status}
                  </button>
                </div>
                {proj.description && <p className="text-xs text-gray-400 truncate">{proj.description}</p>}
                <p className="text-xs text-gray-400">{proj.email_count} email{proj.email_count !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={e => deleteProject(proj.id, e)}
                className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1 flex-shrink-0 text-xs">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
