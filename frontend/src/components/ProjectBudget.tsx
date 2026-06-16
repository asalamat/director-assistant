import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { Spinner } from './ui'

interface BudgetTask {
  id: number
  phase_name: string
  name: string
  duration_days: number
  hourly_rate: number
  estimated_cost: number
  status: string
}

interface BudgetData {
  budget_total: number
  estimated_cost: number
  actual_cost_estimate: number
  tasks_breakdown: BudgetTask[]
}

interface Props { projectId: number }

const fmt = (n: number) =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export function ProjectBudget({ projectId }: Props) {
  const [data, setData] = useState<BudgetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getProjectBudget(projectId)
      setData(r)
      setBudgetInput(String(r.budget_total || 0))
    } catch { /* silent */ }
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  const saveBudget = async () => {
    if (!data) return
    setSaving(true)
    try {
      await api.updateProjectBudget(projectId, parseFloat(budgetInput) || 0)
      setData(prev => prev ? { ...prev, budget_total: parseFloat(budgetInput) || 0 } : prev)
      setEditingBudget(false)
    } catch { /* silent */ }
    setSaving(false)
  }

  if (loading) return <div className="flex justify-center py-4"><Spinner size="sm" /></div>
  if (!data) return null

  const { budget_total, estimated_cost, actual_cost_estimate, tasks_breakdown } = data
  const variance = budget_total - estimated_cost
  const isOver = variance < 0
  const hasRates = tasks_breakdown.some(t => t.hourly_rate > 0)

  // Group tasks by phase
  const phases = Array.from(new Set(tasks_breakdown.map(t => t.phase_name)))

  return (
    <div className="pt-4 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-700 mb-3">Budget</p>

      {/* Summary card */}
      <div className={`rounded-xl p-3 mb-3 border ${isOver ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Budget</p>
            {editingBudget ? (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-xs text-gray-500">$</span>
                <input type="number" min="0" value={budgetInput}
                  onChange={e => setBudgetInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveBudget(); if (e.key === 'Escape') setEditingBudget(false) }}
                  className="w-24 text-sm font-semibold border border-gray-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus />
                <button onClick={saveBudget} disabled={saving}
                  className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded hover:bg-blue-600 disabled:opacity-50">
                  {saving ? '…' : 'OK'}
                </button>
                <button onClick={() => setEditingBudget(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
              </div>
            ) : (
              <button onClick={() => setEditingBudget(true)} title="Click to edit budget"
                className="text-sm font-bold text-gray-800 hover:text-blue-600 transition-colors">
                {fmt(budget_total)}
              </button>
            )}
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Estimated</p>
            <p className="text-sm font-bold text-gray-800">{fmt(estimated_cost)}</p>
          </div>
          {actual_cost_estimate > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Actual (done)</p>
              <p className="text-sm font-bold text-gray-800">{fmt(actual_cost_estimate)}</p>
            </div>
          )}
          {budget_total > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Variance</p>
              <p className={`text-sm font-bold ${isOver ? 'text-red-600' : 'text-green-600'}`}>
                {isOver ? '-' : '+'}{fmt(Math.abs(variance))}
              </p>
            </div>
          )}
        </div>
        {!hasRates && (
          <p className="text-[10px] text-gray-400 mt-2 italic">
            Set hourly rates on tasks (expand a task card) to calculate costs.
          </p>
        )}
      </div>

      {/* Task breakdown table */}
      {hasRates && (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2 text-left text-[10px] text-gray-500 font-semibold">Task</th>
                <th className="px-2 py-2 text-right text-[10px] text-gray-500 font-semibold">Days</th>
                <th className="px-2 py-2 text-right text-[10px] text-gray-500 font-semibold">$/hr</th>
                <th className="px-2 py-2 text-right text-[10px] text-gray-500 font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {phases.map(phase => {
                const phaseTasks = tasks_breakdown.filter(t => t.phase_name === phase && t.hourly_rate > 0)
                if (phaseTasks.length === 0) return null
                const phaseTotal = phaseTasks.reduce((s, t) => s + t.estimated_cost, 0)
                return (
                  <>
                    <tr key={`phase-${phase}`} className="bg-gray-50 border-t border-gray-100">
                      <td colSpan={3} className="px-3 py-1.5 text-[10px] font-bold text-gray-700">{phase || 'General'}</td>
                      <td className="px-2 py-1.5 text-[10px] font-bold text-gray-700 text-right">{fmt(phaseTotal)}</td>
                    </tr>
                    {phaseTasks.map(t => (
                      <tr key={t.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-gray-600 pl-5">{t.name}</td>
                        <td className="px-2 py-1.5 text-gray-500 text-right">{t.duration_days}</td>
                        <td className="px-2 py-1.5 text-gray-500 text-right">{t.hourly_rate}</td>
                        <td className="px-2 py-1.5 text-right font-medium text-gray-700">{fmt(t.estimated_cost)}</td>
                      </tr>
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
