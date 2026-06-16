import { useState, useEffect } from 'react'
import { api } from '../api/client'

interface Note { id: number; note: string; created_at: string }
interface Recommendations {
  on_track: string[]; at_risk: string[]; recommendations: string[]
  health: 'GREEN' | 'AMBER' | 'RED'; health_reason: string
}

const HEALTH_STYLES: Record<string, string> = {
  GREEN: 'bg-green-100 text-green-700 border-green-200',
  AMBER: 'bg-amber-100 text-amber-700 border-amber-200',
  RED:   'bg-red-100 text-red-700 border-red-200',
}

export function ProjectNotes({ projectId }: { projectId: number }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [recs, setRecs] = useState<Recommendations | null>(null)
  const [recsLoading, setRecsLoading] = useState(false)
  const [recsMsg, setRecsMsg] = useState('')

  useEffect(() => {
    api.getProjectNotes(projectId).then(r => setNotes(r.notes)).catch(() => {})
  }, [projectId])

  const addNote = async () => {
    if (!input.trim() || saving) return
    setSaving(true)
    try {
      const r = await api.addProjectNote(projectId, input.trim())
      setNotes(prev => [...prev, { id: r.id, note: r.note, created_at: new Date().toISOString() }])
      setInput('')
    } catch { /* silent */ }
    setSaving(false)
  }

  const deleteNote = async (id: number) => {
    await api.deleteProjectNote(projectId, id).catch(() => {})
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  const getRecommendations = async () => {
    setRecsLoading(true); setRecsMsg(''); setRecs(null)
    try {
      const r = await api.getProjectRecommendations(projectId)
      setRecs(r.recommendations)
    } catch (e: any) { setRecsMsg(e.message || 'Failed') }
    setRecsLoading(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Progress Notes</p>
        <button onClick={getRecommendations} disabled={recsLoading || notes.length === 0}
          className="text-xs bg-accent/10 text-accent border border-accent/30 px-2.5 py-1 rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors">
          {recsLoading ? '⟳ Analyzing…' : '✦ AI Review'}
        </button>
      </div>

      {/* Note input */}
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }}
          placeholder="Add a progress update, blocker, or observation… (⌘↵ to save)"
          rows={2}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
        />
        <button onClick={addNote} disabled={saving || !input.trim()}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 self-end">
          {saving ? '…' : 'Add'}
        </button>
      </div>

      {/* Notes list */}
      {notes.length === 0 && (
        <p className="text-xs text-gray-400 italic text-center py-2">No notes yet — add updates as the project progresses</p>
      )}
      <div className="space-y-1.5">
        {notes.map(n => (
          <div key={n.id} className="border border-gray-100 rounded-lg px-3 py-2 group flex gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-700 leading-relaxed">{n.note}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{n.created_at.slice(0, 10)}</p>
            </div>
            <button onClick={() => deleteNote(n.id)}
              className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xs flex-shrink-0">✕</button>
          </div>
        ))}
      </div>

      {recsMsg && <p className="text-xs text-red-500">{recsMsg}</p>}

      {/* AI Recommendations */}
      {recs && (
        <div className="space-y-2">
          <div className={`border rounded-xl p-3 ${HEALTH_STYLES[recs.health] || HEALTH_STYLES.AMBER}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold">{recs.health === 'GREEN' ? '✅' : recs.health === 'RED' ? '🔴' : '⚠️'} {recs.health}</span>
            </div>
            <p className="text-xs">{recs.health_reason}</p>
          </div>
          {recs.on_track.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-green-700 uppercase mb-1">On Track</p>
              <ul className="space-y-0.5">{recs.on_track.map((s, i) => <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-green-500 flex-shrink-0">✓</span>{s}</li>)}</ul>
            </div>
          )}
          {recs.at_risk.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-amber-700 uppercase mb-1">At Risk</p>
              <ul className="space-y-0.5">{recs.at_risk.map((s, i) => <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-amber-500 flex-shrink-0">⚠</span>{s}</li>)}</ul>
            </div>
          )}
          {recs.recommendations.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-blue-700 uppercase mb-1">Recommendations</p>
              <ul className="space-y-0.5">{recs.recommendations.map((s, i) => <li key={i} className="text-xs text-gray-700 flex gap-1.5"><span className="text-accent flex-shrink-0">→</span>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
