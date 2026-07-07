import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { Cluster } from '../../types'

interface ProjectsTabProps {
  onSelectCluster: (cluster: Cluster) => void
}

const INTERVIEW_KEYWORDS = ['interview', 'recruiter', 'position', 'hiring']

function isInterviewCluster(c: Cluster): boolean {
  const text = [c.name, ...(c.keywords || [])].join(' ').toLowerCase()
  return INTERVIEW_KEYWORDS.some(kw => text.includes(kw))
}

export function ProjectsTab({ onSelectCluster }: ProjectsTabProps) {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [allClusters, setAllClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'dormant' | 'resolved' | 'disabled'>('all')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [prepCluster, setPrepCluster] = useState<Cluster | null>(null)
  const [prepLoading, setPrepLoading] = useState(false)
  const [prepText, setPrepText] = useState('')
  const [prepError, setPrepError] = useState('')
  const [copied, setCopied] = useState(false)

  const loadClusters = () => {
    setLoading(true)
    api.getClusters(true).then(r => {
      setAllClusters(r.clusters)
      setClusters(r.clusters)
    }).catch(() => { setAllClusters([]); setClusters([]) }).finally(() => setLoading(false))
  }

  useEffect(() => { loadClusters() }, [])

  const handleToggleDisable = async (e: React.MouseEvent, c: Cluster) => {
    e.stopPropagation()
    setTogglingId(c.id)
    const next = c.status === 'disabled' ? 'active' : 'disabled'
    try {
      await api.updateClusterStatus(c.id, next)
      setAllClusters(prev => prev.map(x => x.id === c.id ? { ...x, status: next } : x))
      setClusters(prev => prev.map(x => x.id === c.id ? { ...x, status: next } : x))
    } catch { /* ignore */ } finally {
      setTogglingId(null)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setGenerateError('')
    try {
      const r = await api.generateClusters()
      if (!r.clusters?.length) {
        setGenerateError(r.error || 'No clusters returned — make sure an AI provider is configured in Settings.')
      } else {
        setAllClusters(r.clusters)
        setClusters(r.clusters)
      }
    } catch (e: any) {
      setGenerateError(e.message || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const handleInterviewPrep = async (e: React.MouseEvent, cluster: Cluster) => {
    e.stopPropagation()
    setPrepCluster(cluster)
    setPrepLoading(true)
    setPrepText('')
    setPrepError('')
    setCopied(false)
    try {
      const resp = await fetch('/api/intelligence/interview-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_ids: cluster.email_ids || [], cluster_name: cluster.name }),
      })
      if (!resp.ok) throw new Error(`Error ${resp.status}`)
      const data = await resp.json()
      setPrepText(data.prep || 'No prep generated.')
    } catch (err: any) {
      setPrepError(err.message || 'Failed to generate prep')
    } finally {
      setPrepLoading(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(prepText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const filtered = filter === 'all'
    ? allClusters.filter(c => c.status !== 'disabled')
    : allClusters.filter(c => c.status === filter)

  const disabledCount = allClusters.filter(c => c.status === 'disabled').length

  const statusStyle = (s: string) =>
    s === 'active'   ? 'bg-green-100 text-green-700' :
    s === 'dormant'  ? 'bg-amber-100 text-amber-700' :
    s === 'disabled' ? 'bg-gray-100 text-gray-400 line-through' :
    'bg-gray-100 text-gray-500'

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <div className="flex gap-1 flex-1 flex-wrap">
          {(['all', 'active', 'dormant', 'resolved'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === f ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'all' ? ` (${allClusters.filter(c => c.status !== 'disabled').length})` : ` (${allClusters.filter(c => c.status === f).length})`}
            </button>
          ))}
          {disabledCount > 0 && (
            <button onClick={() => setFilter(filter === 'disabled' ? 'all' : 'disabled')}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === 'disabled' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-100 border border-dashed border-gray-300'}`}>
              Disabled ({disabledCount})
            </button>
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex-shrink-0"
        >
          {generating ? '⟳ Analyzing…' : clusters.length ? '↺ Regenerate' : '✦ Generate Clusters'}
        </button>
      </div>
      {generateError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mx-4 mb-2 flex-shrink-0">{generateError}</p>
      )}
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
            <div
              key={c.id}
              className={`text-left border rounded-xl p-4 transition-colors group relative ${
                c.status === 'disabled'
                  ? 'border-gray-100 bg-gray-50/50 opacity-60'
                  : 'border-gray-200 hover:border-accent hover:bg-blue-50/30 cursor-pointer'
              }`}
              onClick={() => c.status !== 'disabled' && onSelectCluster(c)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-semibold transition-colors ${c.status === 'disabled' ? 'text-gray-400' : 'text-gray-800 group-hover:text-accent'}`}>{c.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusStyle(c.status)}`}>{c.status}</span>
                  <button
                    onClick={e => handleToggleDisable(e, c)}
                    disabled={togglingId === c.id}
                    title={c.status === 'disabled' ? 'Re-enable this cluster' : 'Disable this cluster'}
                    className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-colors disabled:opacity-50 ${
                      c.status === 'disabled'
                        ? 'border-green-200 text-green-600 hover:bg-green-50 bg-white'
                        : 'border-gray-200 text-gray-400 hover:border-red-200 hover:text-red-500 hover:bg-red-50 bg-white'
                    }`}
                  >
                    {togglingId === c.id ? '…' : c.status === 'disabled' ? 'Enable' : 'Disable'}
                  </button>
                </div>
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
              {isInterviewCluster(c) && c.status !== 'disabled' && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={e => handleInterviewPrep(e, c)}
                    className="text-[11px] bg-purple-600 text-white px-2.5 py-1 rounded-lg hover:bg-purple-700 transition-colors w-full text-center"
                  >
                    Interview Prep
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {prepCluster && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-800">Interview Prep: {prepCluster.name}</h2>
              <button onClick={() => setPrepCluster(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {prepLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mr-3" />
                  <span className="text-sm text-gray-500">Analyzing email history…</span>
                </div>
              )}
              {prepError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{prepError}</p>
              )}
              {prepText && !prepLoading && (
                <div className="space-y-3">
                  {prepText.split('\n\n').map((para, i) => (
                    <p key={i} className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{para}</p>
                  ))}
                </div>
              )}
            </div>
            {prepText && !prepLoading && (
              <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={handleCopy}
                  className="flex-1 text-sm bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy to Clipboard'}
                </button>
                <button
                  onClick={() => setPrepCluster(null)}
                  className="flex-1 text-sm bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
            {!prepText && !prepLoading && (
              <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
                <button onClick={() => setPrepCluster(null)} className="w-full text-sm bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
