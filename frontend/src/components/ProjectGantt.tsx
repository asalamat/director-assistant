import { useState, useRef } from 'react'

export interface GanttTask {
  id: number; name: string; phase_name: string
  status: string; duration_days: number
  assignee: string; depends_on?: string[]
  progress?: number
}

interface GanttRow {
  kind: 'phase' | 'task'; label: string; taskId?: number
  durationDays: number; offset: number; pct: number
  status?: string; assignee?: string; deps?: string[]
}

interface Tip { x: number; y: number; label: string; assignee: string; status: string }

const STATUS_FILL: Record<string, string> = {
  done: '#22c55e', in_progress: '#3b82f6', blocked: '#ef4444', not_started: '#d1d5db',
}
const BH = 18, RP = 8, RS = BH + RP, LW = 140, BA = 340, PW = 42, VW = LW + BA + PW

function phasePct(tasks: GanttTask[], ph: string) {
  const ts = tasks.filter(t => t.phase_name === ph)
  return ts.length ? Math.round(ts.filter(t => t.status === 'done').length / ts.length * 100) : 0
}
function taskPct(t: GanttTask) {
  if (t.progress !== undefined && t.progress > 0) return t.progress
  return t.status === 'done' ? 100 : t.status === 'in_progress' ? 50 : 0
}
function total(tasks: GanttTask[]) { return tasks.reduce((s, t) => s + (t.duration_days || 1), 0) || 1 }
function bx(off: number, tot: number) { return LW + (off / tot) * BA }
function bw(d: number, tot: number) { return Math.max(2, (d / tot) * BA) }

function buildRows(tasks: GanttTask[]): GanttRow[] {
  const phases = [...new Set(tasks.map(t => t.phase_name))]
  const rows: GanttRow[] = []
  let off = 0
  for (const ph of phases) {
    const pts = tasks.filter(t => t.phase_name === ph)
    rows.push({ kind: 'phase', label: ph, durationDays: pts.reduce((s, t) => s + (t.duration_days || 1), 0), offset: off, pct: phasePct(tasks, ph) })
    for (const t of pts) {
      rows.push({ kind: 'task', label: t.name, taskId: t.id, durationDays: t.duration_days || 1, offset: off, pct: taskPct(t), status: t.status, assignee: t.assignee, deps: t.depends_on })
      off += t.duration_days || 1
    }
  }
  return rows
}

export function ProjectGantt({ tasks }: { tasks: GanttTask[] }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const ref = useRef<SVGSVGElement>(null)

  if (!tasks.length) return (
    <p className="text-xs text-gray-400 italic py-4 text-center">No tasks — load tasks from plan to view the Gantt chart.</p>
  )

  const tot  = total(tasks)
  const rows = buildRows(tasks)
  const vh   = rows.length * RS + 12
  const byId = Object.fromEntries(tasks.map(t => [String(t.id), t]))
  const rowIdx: Record<number, number> = {}
  rows.forEach((r, i) => { if (r.taskId !== undefined) rowIdx[r.taskId] = i })
  const cy = (i: number) => i * RS + BH / 2 + 6

  const showTip = (e: React.MouseEvent, r: GanttRow) => {
    if (r.kind !== 'task') return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, label: r.label, assignee: r.assignee || '—', status: r.status || 'not_started' })
  }

  return (
    <div className="relative overflow-x-auto">
      <svg ref={ref} viewBox={`0 0 ${VW} ${vh}`} width="100%" style={{ display: 'block', minWidth: 380 }} onMouseLeave={() => setTip(null)}>
        <defs>
          <marker id="garr" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5 Z" fill="#cbd5e1" />
          </marker>
        </defs>

        {rows.map((r, i) => {
          const y = i * RS + 6, mid = y + BH / 2
          const isP = r.kind === 'phase'
          const x = bx(r.offset, tot), w = bw(r.durationDays, tot)
          const fill = isP ? '#94a3b8' : (STATUS_FILL[r.status || 'not_started'] || STATUS_FILL.not_started)
          return (
            <g key={i}>
              <clipPath id={`lc${i}`}><rect x={0} y={y} width={LW - 4} height={BH} /></clipPath>
              <text x={isP ? 2 : 12} y={mid + 4} fontSize={isP ? 10 : 9} fontWeight={isP ? 700 : 400}
                fill={isP ? '#1e293b' : '#475569'} clipPath={`url(#lc${i})`}>{r.label}</text>
              <rect x={x} y={y + 2} width={w} height={BH - 4} rx={3} fill={isP ? '#e2e8f0' : '#f1f5f9'} />
              <rect x={x} y={y + 2} width={Math.max(2, w * (r.pct / 100))} height={BH - 4} rx={3}
                fill={fill} opacity={isP ? 0.65 : 1}
                onMouseMove={e => showTip(e, r)} onMouseLeave={() => setTip(null)} />
              <text x={LW + BA + 4} y={mid + 4} fontSize={9} fill={isP ? '#1e293b' : '#64748b'} fontWeight={isP ? 600 : 400}>{r.pct}%</text>
            </g>
          )
        })}

        {rows.map((r, i) => {
          if (r.kind !== 'task' || !r.deps?.length) return null
          return r.deps.map(dId => {
            const dep = byId[dId]; if (!dep) return null
            const di = rowIdx[dep.id]; if (di === undefined) return null
            const dr = rows[di]
            return (
              <path key={`${dId}->${r.taskId}`}
                d={`M${bx(dr.offset, tot) + bw(dr.durationDays, tot)},${cy(di)} C${bx(dr.offset, tot) + bw(dr.durationDays, tot) + 12},${cy(di)} ${bx(r.offset, tot) - 12},${cy(i)} ${bx(r.offset, tot)},${cy(i)}`}
                fill="none" stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 2" markerEnd="url(#garr)" />
            )
          })
        })}
      </svg>

      {tip && (
        <div className="absolute z-50 bg-gray-900 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg pointer-events-none"
          style={{ left: tip.x + 10, top: tip.y - 10, maxWidth: 200 }}>
          <p className="font-medium truncate">{tip.label}</p>
          <p className="text-gray-300 mt-0.5">{tip.assignee}</p>
          <p className="text-gray-400 capitalize mt-0.5">{tip.status.replace(/_/g, ' ')}</p>
        </div>
      )}
    </div>
  )
}
