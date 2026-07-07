import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { CRMDeal } from '../types'
import { CRMDealDetail } from './CRMDealDetail'

const STAGE_ORDER = ['prospect', 'active', 'negotiating', 'won', 'lost']
const STAGE_LABEL: Record<string, string> = {
  prospect: 'Prospect', active: 'Active', negotiating: 'Negotiating', won: 'Won', lost: 'Lost',
}
const STAGE_HEADER: Record<string, string> = {
  prospect: 'bg-slate-100 text-slate-700', active: 'bg-blue-100 text-blue-700',
  negotiating: 'bg-amber-100 text-amber-700', won: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-red-100 text-red-700',
}
const STAGE_BORDER: Record<string, string> = {
  prospect: 'border-slate-200', active: 'border-blue-200',
  negotiating: 'border-amber-200', won: 'border-emerald-200', lost: 'border-red-200',
}

function parseValue(v: string): number {
  if (!v) return 0
  const m = v.replace(/[, ]/g, '').match(/([\d.]+)\s*([kKmM]?)/)
  if (!m) return 0
  let n = parseFloat(m[1])
  if (m[2].toLowerCase() === 'k') n *= 1000
  if (m[2].toLowerCase() === 'm') n *= 1_000_000
  return isNaN(n) ? 0 : n
}

function fmtTotal(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `$${Math.round(n / 1000)}k`
  if (n > 0) return `$${n}`
  return ''
}

interface Props {
  onDraft?: (draft: { to: string; subject: string; body: string }) => void
}

export function CRMPipeline({ onDraft }: Props) {
  const [columns, setColumns] = useState<Record<string, CRMDeal[]>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<CRMDeal | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newDeal, setNewDeal] = useState({ name: '', contact_email: '', value: '', stage: 'prospect' })

  const load = useCallback(() => {
    api.getCRMKanban()
      .then(r => {
        const map: Record<string, CRMDeal[]> = {}
        r.columns.forEach(c => { map[c.stage] = c.deals })
        setColumns(map)
        setSelected(prev => {
          if (!prev) return null
          for (const c of r.columns) {
            const found = c.deals.find(d => d.id === prev.id)
            if (found) return found
          }
          return null
        })
      })
      .catch(() => setColumns({}))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const createDeal = async () => {
    if (!newDeal.name.trim()) return
    await api.createCRMDeal({ ...newDeal, notes: '' }).catch(() => {})
    setShowNew(false)
    setNewDeal({ name: '', contact_email: '', value: '', stage: 'prospect' })
    load()
  }

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>

  const stages = STAGE_ORDER.filter(s => columns[s] !== undefined || true)

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-800 flex-1">Deal Pipeline</h2>
        <button onClick={() => setShowNew(v => !v)}
          className="text-xs bg-accent text-white rounded-lg px-2.5 py-1.5 hover:opacity-90 transition">+ Add Deal</button>
      </div>

      {showNew && (
        <div className="mx-4 mb-2 border border-gray-200 rounded-xl p-3 bg-gray-50 space-y-2 flex-shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Deal name *" value={newDeal.name} onChange={e => setNewDeal(p => ({ ...p, name: e.target.value }))}
              className="col-span-2 text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent" />
            <input placeholder="Contact email" value={newDeal.contact_email} onChange={e => setNewDeal(p => ({ ...p, contact_email: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent" />
            <input placeholder="Value (e.g. $50k)" value={newDeal.value} onChange={e => setNewDeal(p => ({ ...p, value: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
            <button onClick={createDeal} className="text-xs bg-accent text-white px-3 py-1 rounded-lg hover:opacity-90">Save</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-x-auto px-4 pb-4">
        <div className="flex gap-3 min-w-max h-full pt-1">
          {stages.map(stage => {
            const deals = columns[stage] || []
            const total = deals.reduce((sum, d) => sum + parseValue(d.value), 0)
            return (
              <div key={stage} className={`w-56 flex flex-col rounded-xl border ${STAGE_BORDER[stage]} bg-white/60`}>
                <div className={`px-3 py-2 rounded-t-xl text-xs font-bold uppercase tracking-wide ${STAGE_HEADER[stage]} flex items-center justify-between`}>
                  <span>{STAGE_LABEL[stage]} <span className="opacity-60">({deals.length})</span></span>
                  {fmtTotal(total) && <span className="font-semibold normal-case">{fmtTotal(total)}</span>}
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {deals.map(deal => (
                    <button key={deal.id} onClick={() => setSelected(deal)}
                      className={`w-full text-left border rounded-lg bg-white shadow-sm p-2.5 hover:shadow transition ${STAGE_BORDER[stage]}`}>
                      <p className="text-xs font-semibold text-gray-800 leading-tight">{deal.name}</p>
                      {deal.contact_email && <p className="text-[10px] text-gray-400 truncate mt-0.5">{deal.contact_email}</p>}
                      <div className="flex items-center gap-1.5 mt-1">
                        {deal.value && <span className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{deal.value}</span>}
                        {deal.last_email_at && <span className="text-[10px] text-gray-300 ml-auto">{deal.last_email_at.slice(0, 10)}</span>}
                      </div>
                    </button>
                  ))}
                  {deals.length === 0 && <p className="text-[11px] text-gray-300 text-center py-4">No deals</p>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selected && (
        <CRMDealDetail deal={selected} onClose={() => setSelected(null)} onChanged={load} onDraft={onDraft} />
      )}
    </div>
  )
}
