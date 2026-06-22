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
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'dormant' | 'resolved'>('all')

  const [prepCluster, setPrepCluster] = useState<Cluster | null>(null)
  const [prepLoading, setPrepLoading] = useState(false)
  const [prepText, setPrepText] = useState('')
  const [prepError, setPrepError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.getClusters().then(r => setClusters(r.clusters)).catch(() => setClusters([])).finally(() => setLoading(false))
  }, [])

  const handleGenerate = async () => {
    setGenerating(true)
    setGenerateError('')
    try {
      const r = await api.generateClusters()
      if (!r.clusters?.length) {
        setGenerateError(r.error || 'No clusters returned — make sure an AI provider is configured in Settings.')
      } else {
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
              {isInterviewCluster(c) && (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={e => handleInterviewPrep(e, c)}
                    className="text-[11px] bg-purple-600 text-white px-2.5 py-1 rounded-lg hover:bg-purple-700 transition-colors w-full text-center"
                  >
                    Interview Prep
                  </button>
                </div>
              )}
            </button>
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
