import { useState, useEffect, useRef } from 'react'
import { api } from '../../api/client'
import type { Cluster, OpenLoop } from '../../types'

export function BriefingTab() {
  const [status, setStatus] = useState('')
  const [summary, setSummary] = useState('')
  const [people, setPeople] = useState<string[]>([])
  const [projects, setProjects] = useState<Cluster[]>([])
  const [loops, setLoops] = useState<OpenLoop[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)

  // Features 6 + 9: auto-run on first daily visit
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem('lastBriefingDate') !== today) {
      localStorage.setItem('lastBriefingDate', today)
      handleGenerate()
    }
  }, [])

  const handleGenerate = () => {
    setPeople([]); setProjects([]); setLoops([]); setSummary('')
    setDone(false); setRunning(true)
    setStatus('Starting analysis…')

    stopRef.current = api.streamBriefing((section, content) => {
      if (section === 'status') setStatus(content as string)
      else if (section === 'people') setPeople(content as string[])
      else if (section === 'projects') setProjects(content as Cluster[])
      else if (section === 'loops') setLoops(content as OpenLoop[])
      else if (section === 'summary') { setSummary(content as string); setStatus('') }
      else if (section === 'done') { setRunning(false); setDone(true); setStatus('') }
      else if (section === 'error') { setStatus('Error: ' + content); setRunning(false) }
    })
  }

  const urgencyColor = (u: string) =>
    u === 'high' ? 'text-red-600 bg-red-50 border-red-200' :
    u === 'medium' ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-gray-600 bg-gray-50 border-gray-200'

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Role Transition Briefing</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            AI analysis of your email corpus — understand the state of affairs, key relationships, and open items.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={running}
          className="flex-shrink-0 px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2"
        >
          {running ? (
            <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" /> Analyzing…</>
          ) : (
            <>{done ? 'Regenerate' : 'Brief me on this role'}</>
          )}
        </button>
      </div>

      {status && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-accent rounded-full animate-spin flex-shrink-0" />
          {status}
        </div>
      )}

      {summary && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-blue-800 mb-3">Executive Summary</h3>
          <div className="text-sm text-blue-900 whitespace-pre-line leading-relaxed">{summary}</div>
        </div>
      )}

      {people.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Key Relationships</h3>
          <div className="space-y-1">
            {people.map((p, i) => (
              <div key={i} className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 font-mono">
                {p}
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Active Projects</h3>
          <div className="grid grid-cols-2 gap-2">
            {projects.filter(c => c.status === 'active').slice(0, 6).map((c) => (
              <div key={c.id} className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs font-medium text-gray-800">{c.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{c.status}</span>
                </div>
                <p className="text-xs text-gray-500">{c.description}</p>
                <p className="text-[10px] text-gray-400 mt-1">{c.email_count} emails · {c.last_activity?.slice(0,10)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {loops.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Open Commitments ({loops.length})</h3>
          <div className="space-y-1.5">
            {loops.slice(0, 8).map((l, i) => (
              <div key={i} className={`flex items-start gap-2 border rounded-lg px-3 py-2 text-xs ${urgencyColor(l.urgency)}`}>
                <span className="font-medium capitalize flex-shrink-0">{l.type}</span>
                <span className="flex-1">{l.text}</span>
                <span className="flex-shrink-0 text-[10px] opacity-70">{l.date?.slice(0,10)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!running && !done && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">🧭</div>
          <p className="text-sm">Click "Brief me on this role" to generate an AI-powered analysis of your email corpus.</p>
          <p className="text-xs mt-1">Covers active projects, key relationships, and open commitments.</p>
        </div>
      )}
    </div>
  )
}
