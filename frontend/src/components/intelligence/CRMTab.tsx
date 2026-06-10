import { useState, useEffect } from 'react'
import { api } from '../../api/client'

type Stage = 'prospect' | 'active' | 'negotiating' | 'won' | 'lost'
const STAGES: Stage[] = ['prospect', 'active', 'negotiating', 'won', 'lost']
const STAGE_LABEL: Record<Stage, string> = {
  prospect: 'Prospect', active: 'Active', negotiating: 'Negotiating', won: 'Won ✓', lost: 'Lost'
}
const STAGE_HEADER: Record<Stage, string> = {
  prospect: 'bg-slate-100 text-slate-700', active: 'bg-blue-100 text-blue-700',
  negotiating: 'bg-amber-100 text-amber-700', won: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-red-100 text-red-700'
}
const STAGE_BORDER: Record<Stage, string> = {
  prospect: 'border-slate-200', active: 'border-blue-200',
  negotiating: 'border-amber-200', won: 'border-emerald-200', lost: 'border-red-200'
}

interface Deal {
  id: number; name: string; contact_email: string; stage: Stage
  value: string; notes: string; created_at: string; updated_at: string
}

export function CRMTab() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [dealHistory, setDealHistory] = useState<Record<number, any[]>>({})

  const loadHistory = (id: number) => {
    if (dealHistory[id]) return
    api.getCRMDealHistory(id).then(r => setDealHistory(prev => ({...prev, [id]: r.history}))).catch(() => {})
  }
  const [showNew, setShowNew] = useState(false)
  const [newDeal, setNewDeal] = useState({ name: '', contact_email: '', stage: 'prospect' as Stage, value: '', notes: '' })

  const load = () => api.getCRMDeals().then(r => setDeals(r.deals as Deal[])).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const moveStage = async (id: number, stage: Stage) => {
    setDeals(prev => prev.map(d => d.id === id ? {...d, stage} : d))
    await api.updateCRMDeal(id, { stage }).catch(() => load())
  }

  const deleteDeal = async (id: number) => {
    setDeals(prev => prev.filter(d => d.id !== id))
    await api.deleteCRMDeal(id).catch(() => load())
  }

  const createDeal = async () => {
    if (!newDeal.name.trim()) return
    await api.createCRMDeal(newDeal)
    setShowNew(false)
    setNewDeal({ name: '', contact_email: '', stage: 'prospect', value: '', notes: '' })
    load()
  }

  const addSuggestion = async (s: any) => {
    await api.createCRMDeal({ name: s.name||'', contact_email: s.contact_email||'', stage: 'prospect', value: s.value||'', notes: s.notes||'' })
    setSuggestions(prev => prev.filter(x => x !== s))
    load()
  }

  const extract = async () => {
    setExtracting(true)
    try { const r = await api.extractCRMDeals(); setSuggestions(r.suggestions) } catch {}
    setExtracting(false)
  }

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-shrink-0 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-800 flex-1">Deal Pipeline</h2>
        <button onClick={extract} disabled={extracting}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 hover:border-accent hover:text-accent disabled:opacity-50 transition-colors">
          {extracting ? '…' : '✨ AI Extract Deals'}
        </button>
        <button onClick={() => setShowNew(v => !v)}
          className="text-xs bg-accent text-white rounded-lg px-2.5 py-1.5 hover:bg-blue-700 transition-colors">
          + New Deal
        </button>
      </div>

      {/* New deal form */}
      {showNew && (
        <div className="mx-4 mb-2 border border-gray-200 rounded-xl p-3 bg-gray-50 space-y-2 flex-shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Deal name *" value={newDeal.name} onChange={e => setNewDeal(p => ({...p, name: e.target.value}))}
              className="col-span-2 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"/>
            <input placeholder="Contact email" value={newDeal.contact_email} onChange={e => setNewDeal(p => ({...p, contact_email: e.target.value}))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"/>
            <input placeholder="Value (e.g. $50k)" value={newDeal.value} onChange={e => setNewDeal(p => ({...p, value: e.target.value}))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white"/>
          </div>
          <select value={newDeal.stage} onChange={e => setNewDeal(p => ({...p, stage: e.target.value as Stage}))}
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none bg-white">
            {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
          <textarea placeholder="Notes" value={newDeal.notes} onChange={e => setNewDeal(p => ({...p, notes: e.target.value}))} rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent resize-none bg-white"/>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
            <button onClick={createDeal} className="text-xs bg-accent text-white px-3 py-1 rounded-lg hover:bg-blue-700">Save</button>
          </div>
        </div>
      )}

      {/* AI suggestions */}
      {suggestions.length > 0 && (
        <div className="mx-4 mb-2 border border-amber-200 bg-amber-50 rounded-xl p-3 flex-shrink-0">
          <p className="text-xs font-semibold text-amber-700 mb-2">AI found {suggestions.length} potential deal{suggestions.length!==1?'s':''}</p>
          <div className="space-y-1.5">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-center gap-2 bg-white border border-amber-100 rounded-lg px-2 py-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{s.name}</p>
                  {s.notes && <p className="text-[10px] text-gray-500 truncate">{s.notes}</p>}
                </div>
                <button onClick={() => addSuggestion(s)} className="text-xs text-accent hover:underline flex-shrink-0">Add</button>
                <button onClick={() => setSuggestions(prev => prev.filter((_,j) => j!==i))} className="text-gray-300 hover:text-gray-500 text-xs">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto px-4 pb-4">
        <div className="flex gap-3 min-w-max h-full pt-1">
          {STAGES.map(stage => {
            const stageDeals = deals.filter(d => d.stage === stage)
            const stageIdx = STAGES.indexOf(stage)
            return (
              <div key={stage} className={`w-52 flex flex-col rounded-xl border ${STAGE_BORDER[stage]} bg-white/60`}>
                <div className={`px-3 py-2 rounded-t-xl text-xs font-bold uppercase tracking-wide ${STAGE_HEADER[stage]}`}>
                  {STAGE_LABEL[stage]} <span className="ml-1 opacity-60">({stageDeals.length})</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {stageDeals.map(deal => (
                    <div key={deal.id} className={`border rounded-lg bg-white shadow-sm cursor-pointer ${STAGE_BORDER[stage]}`}>
                      <div className="p-2.5" onClick={() => { setExpandedId(expandedId === deal.id ? null : deal.id); if (expandedId !== deal.id) loadHistory(deal.id) }}>
                        <p className="text-xs font-semibold text-gray-800 leading-tight">{deal.name}</p>
                        {deal.contact_email && <p className="text-[10px] text-gray-400 truncate mt-0.5">{deal.contact_email}</p>}
                        {deal.value && <span className="inline-block mt-1 text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{deal.value}</span>}
                      </div>
                      {expandedId === deal.id && (
                        <div className="border-t border-gray-100 px-2.5 pb-2.5 space-y-1.5">
                          {deal.notes && <p className="text-[10px] text-gray-500 leading-relaxed">{deal.notes}</p>}
                          <div className="flex gap-1 flex-wrap">
                            {stageIdx > 0 && (
                              <button onClick={() => moveStage(deal.id, STAGES[stageIdx-1])}
                                className="text-[10px] border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-50">← {STAGE_LABEL[STAGES[stageIdx-1]]}</button>
                            )}
                            {stageIdx < STAGES.length-1 && (
                              <button onClick={() => moveStage(deal.id, STAGES[stageIdx+1])}
                                className={`text-[10px] border rounded px-1.5 py-0.5 ${STAGE_BORDER[STAGES[stageIdx+1]]} hover:bg-gray-50`}>{STAGE_LABEL[STAGES[stageIdx+1]]} →</button>
                            )}
                            <button onClick={() => deleteDeal(deal.id)} className="text-[10px] text-red-400 hover:text-red-600 ml-auto">Delete</button>
                          </div>
                          {dealHistory[deal.id] && dealHistory[deal.id].length > 0 && (
                            <div className="mt-1.5 border-t border-gray-50 pt-1.5">
                              <p className="text-[9px] font-bold uppercase tracking-wide text-gray-300 mb-1">Stage history</p>
                              {dealHistory[deal.id].slice(0, 4).map((h: any, i: number) => (
                                <p key={i} className="text-[9px] text-gray-400">
                                  {h.changed_at?.slice(0, 10)} · {h.from_stage} → {h.to_stage}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
