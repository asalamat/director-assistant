import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { Cluster } from '../../types'

interface ProjectsTabProps {
  onSelectCluster: (cluster: Cluster) => void
}

export function ProjectsTab({ onSelectCluster }: ProjectsTabProps) {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'dormant' | 'resolved'>('all')

  useEffect(() => {
    api.getClusters().then(r => setClusters(r.clusters)).catch(() => setClusters([])).finally(() => setLoading(false))
  }, [])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const r = await api.generateClusters()
      setClusters(r.clusters)
    } catch { /* ignore */ }
    finally { setGenerating(false) }
  }

  const filtered = filter === 'all' ? clusters : clusters.filter(c => c.status === filter)

  const statusStyle = (s: string) =>
    s === 'active' ? 'bg-green-100 text-green-700' :
    s === 'dormant' ? 'bg-amber-100 text-amber-700' :
    'bg-gray-100 text-gray-500'

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <div className="flex gap-1 flex-1">
          {(['all', 'active', 'dormant', 'resolved'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === f ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'all' ? ` (${clusters.length})` : ` (${clusters.filter(c => c.status === f).length})`}
            </button>
          ))}
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0"
        >
          {generating ? '⟳ Analyzing…' : clusters.length ? '↺ Regenerate' : '✦ Generate Clusters'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-2xl mb-2">🗂</p>
            <p className="text-sm text-gray-500 mb-4">No clusters yet</p>
            <button onClick={handleGenerate} disabled={generating}
              className="text-sm bg-accent text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {generating ? '⟳ Analyzing emails…' : '✦ Generate Clusters'}
            </button>
            <p className="text-xs text-gray-400 mt-2">AI will read your emails and group them into projects and topics</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 pt-2">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => onSelectCluster(c)}
              className="text-left border border-gray-200 rounded-xl p-4 hover:border-accent hover:bg-blue-50/30 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-800 group-hover:text-accent transition-colors">{c.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusStyle(c.status)}`}>{c.status}</span>
              </div>
              <p className="text-xs text-gray-500 mb-2 leading-relaxed">{c.description}</p>
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span>{c.email_count} emails</span>
                <span>{c.last_activity?.slice(0, 10)}</span>
              </div>
              {c.keywords?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {c.keywords.slice(0, 3).map(kw => (
                    <span key={kw} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{kw}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
