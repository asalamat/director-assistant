import { useMemo } from 'react'

interface Task {
  id: number
  status: string
  name?: string
  phase_name?: string
  duration_days?: number
  assignee?: string
  depends_on?: string[]
}

interface ProjectDashboardProps {
  project: { id: number; name: string; created_at: string }
  tasks: Task[]
  plan: { estimated_duration_weeks?: number } | null
  recommendations?: { health?: string } | null
}

function CircleProgress({ pct }: { pct: number }) {
  const r = 18
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <svg width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" stroke="#e2e8f0" strokeWidth="4" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="#3b82f6" strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 22 22)" />
      <text x="22" y="26" textAnchor="middle" fontSize="9" fontWeight="600" fill="#1e293b">
        {pct}%
      </text>
    </svg>
  )
}

function TaskBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return <div className="w-full h-2 bg-gray-100 rounded-full" />
  const segs = [
    { key: 'done',        color: 'bg-green-400' },
    { key: 'in_progress', color: 'bg-blue-400' },
    { key: 'blocked',     color: 'bg-red-400' },
    { key: 'not_started', color: 'bg-gray-200' },
  ]
  return (
    <div className="flex w-full h-2 rounded-full overflow-hidden gap-px">
      {segs.map(s => {
        const w = Math.round((counts[s.key] / total) * 100)
        return w > 0 ? (
          <div key={s.key} className={`${s.color} h-full`} style={{ width: `${w}%` }} title={`${s.key}: ${counts[s.key]}`} />
        ) : null
      })}
    </div>
  )
}

const HEALTH_STYLE: Record<string, string> = {
  GREEN: 'bg-green-100 text-green-700',
  AMBER: 'bg-amber-100 text-amber-700',
  RED:   'bg-red-100 text-red-700',
}

export function ProjectDashboard({ project, tasks, plan, recommendations }: ProjectDashboardProps) {
  const counts = useMemo(() => {
    const c: Record<string, number> = { done: 0, in_progress: 0, blocked: 0, not_started: 0 }
    tasks.forEach(t => { c[t.status] = (c[t.status] ?? 0) + 1 })
    return c
  }, [tasks])

  const total = tasks.length
  const pct = total > 0 ? Math.round((counts.done / total) * 100) : 0

  const daysRemaining = useMemo(() => {
    if (!plan?.estimated_duration_weeks || !project.created_at) return null
    try {
      const start = new Date(project.created_at)
      const end = new Date(start.getTime() + plan.estimated_duration_weeks * 7 * 86400000)
      const diff = Math.ceil((end.getTime() - Date.now()) / 86400000)
      return diff
    } catch { return null }
  }, [plan, project.created_at])

  const health = useMemo(() => {
    if (recommendations?.health) return recommendations.health
    if (total === 0) return 'GREEN'
    const blockedPct = total > 0 ? counts.blocked / total : 0
    if (blockedPct > 0.3) return 'RED'
    if (blockedPct > 0.1) return 'AMBER'
    return 'GREEN'
  }, [recommendations, counts, total])

  return (
    <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 mb-3">
      {/* % Complete */}
      <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-100">
        <CircleProgress pct={pct} />
        <div className="min-w-0">
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Complete</p>
          <p className="text-xs text-gray-700">{counts.done}/{total} tasks</p>
        </div>
      </div>

      {/* Task breakdown */}
      <div className="bg-white rounded-lg px-3 py-2 border border-gray-100 flex flex-col justify-center gap-1.5">
        <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Breakdown</p>
        <TaskBar counts={counts} total={total} />
        <div className="flex gap-2 flex-wrap">
          {([
            { k: 'done'        as const, label: 'Done',  color: 'bg-green-400' },
            { k: 'in_progress' as const, label: 'WIP',   color: 'bg-blue-400' },
            { k: 'blocked'     as const, label: 'Block', color: 'bg-red-400' },
          ] as const).map(s => counts[s.k] > 0 ? (
            <span key={s.k} className="flex items-center gap-0.5 text-[9px] text-gray-500">
              <span className={`w-1.5 h-1.5 rounded-full ${s.color}`} />
              {counts[s.k]} {s.label}
            </span>
          ) : null)}
        </div>
      </div>

      {/* Days remaining */}
      <div className="bg-white rounded-lg px-3 py-2 border border-gray-100 flex items-center gap-2">
        <span className="text-xl leading-none">&#128197;</span>
        <div>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Timeline</p>
          {daysRemaining === null
            ? <p className="text-xs text-gray-400 italic">No estimate</p>
            : daysRemaining < 0
              ? <p className="text-xs text-red-600 font-medium">{Math.abs(daysRemaining)}d overdue</p>
              : <p className="text-xs text-gray-700">{daysRemaining}d left</p>
          }
        </div>
      </div>

      {/* Health */}
      <div className="bg-white rounded-lg px-3 py-2 border border-gray-100 flex items-center gap-2">
        <span className="text-xl leading-none">{health === 'GREEN' ? '🟢' : health === 'AMBER' ? '🟡' : '🔴'}</span>
        <div>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Health</p>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${HEALTH_STYLE[health] || HEALTH_STYLE.GREEN}`}>
            {health}
          </span>
        </div>
      </div>
    </div>
  )
}
