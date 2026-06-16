import { useState, useRef } from 'react'

export interface GanttTask {
  id: number
  name: string
  phase_name: string
  status: string
  duration_days: number
  assignee: string
  depends_on?: string[]
}

interface GanttRow {
  kind: 'phase' | 'task'
  label: string
  taskId?: number
  durationDays: number
  offset: number
  pct: number
  status?: string
  assignee?: string
  deps?: string[]
}

interface Tooltip {
  x: number
  y: number
  label: string
  assignee: string
  status: string
}

const STATUS_FILL: Record<string, string> = {
  done:        '#22c55e',
  in_progress: '#3b82f6',
  blocked:     '#ef4444',
  not_started: '#d1d5db',
}

const BAR_HEIGHT  = 18
const ROW_PADDING = 8
const ROW_STRIDE  = BAR_HEIGHT + ROW_PADDING
const LABEL_W     = 140
const BAR_AREA    = 340
const PCT_W       = 42
const VIEW_W      = LABEL_W + BAR_AREA + PCT_W

function phasePct(tasks: GanttTask[], phaseName: string): number {
  const ts = tasks.filter(t => t.phase_name === phaseName)
  if (!ts.length) return 0
  const done = ts.filter(t => t.status === 'done').length
  return Math.round((done / ts.length) * 100)
}

function taskPct(status: string): number {
  if (status === 'done') return 100
  if (status === 'in_progress') return 50
  return 0
}

function totalDays(tasks: GanttTask[]): number {
  return tasks.reduce((s, t) => s + (t.duration_days || 1), 0) || 1
}

function buildRows(tasks: GanttTask[]): GanttRow[] {
  const phases = [...new Set(tasks.map(t => t.phase_name))]
  const rows: GanttRow[] = []
  let offset = 0
  for (const ph of phases) {
    const phTasks  = tasks.filter(t => t.phase_name === ph)
    const phDays   = phTasks.reduce((s, t) => s + (t.duration_days || 1), 0)
    rows.push({ kind: 'phase', label: ph, durationDays: phDays, offset, pct: phasePct(tasks, ph) })
    for (const t of phTasks) {
      rows.push({
        kind: 'task', label: t.name, taskId: t.id,
        durationDays: t.duration_days || 1, offset,
        pct: taskPct(t.status), status: t.status,
        assignee: t.assignee, deps: t.depends_on,
      })
      offset += t.duration_days || 1
    }
  }
  return rows
}

function barX(offset: number, total: number): number {
  return LABEL_W + (offset / total) * BAR_AREA
}
function barW(days: number, total: number): number {
  return Math.max(2, (days / total) * BAR_AREA)
}

interface ProjectGanttProps { tasks: GanttTask[] }

export function ProjectGantt({ tasks }: ProjectGanttProps) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  if (!tasks.length) return (
    <p className="text-xs text-gray-400 italic py-4 text-center">No tasks — load tasks from plan to view the Gantt chart.</p>
  )

  const total  = totalDays(tasks)
  const rows   = buildRows(tasks)
  const viewH  = rows.length * ROW_STRIDE + 12
  const byId   = Object.fromEntries(tasks.map(t => [String(t.id), t]))

  // Map taskId → row index for dependency arrows
  const rowIndexById: Record<number, number> = {}
  rows.forEach((r, i) => { if (r.taskId !== undefined) rowIndexById[r.taskId] = i })

  const rowCenterY = (i: number) => i * ROW_STRIDE + BAR_HEIGHT / 2 + 6

  const showTip = (e: React.MouseEvent, r: GanttRow) => {
    if (r.kind !== 'task') return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      label: r.label,
      assignee: r.assignee || '—',
      status: r.status || 'not_started',
    })
  }

  return (
    <div className="relative overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${viewH}`}
        width="100%"
        style={{ display: 'block', minWidth: 380 }}
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          <marker id="gantt-arr" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5 Z" fill="#cbd5e1" />
          </marker>
        </defs>

        {rows.map((r, i) => {
          const y      = i * ROW_STRIDE + 6
          const bx     = barX(r.offset, total)
          const bw     = barW(r.durationDays, total)
          const mid    = y + BAR_HEIGHT / 2
          const isPhase = r.kind === 'phase'
          const fill   = isPhase ? '#94a3b8' : (STATUS_FILL[r.status || 'not_started'] || STATUS_FILL.not_started)

          return (
            <g key={i}>
              {/* Clip for label text */}
              <clipPath id={`lc${i}`}>
                <rect x={0} y={y} width={LABEL_W - 4} height={BAR_HEIGHT} />
              </clipPath>

              {/* Label */}
              <text
                x={isPhase ? 2 : 12}
                y={mid + 4}
                fontSize={isPhase ? 10 : 9}
                fontWeight={isPhase ? 700 : 400}
                fill={isPhase ? '#1e293b' : '#475569'}
                clipPath={`url(#lc${i})`}
              >
                {r.label}
              </text>

              {/* Background track */}
              <rect x={bx} y={y + 2} width={bw} height={BAR_HEIGHT - 4}
                rx={3} fill={isPhase ? '#e2e8f0' : '#f1f5f9'} />

              {/* Fill bar */}
              <rect
                x={bx} y={y + 2}
                width={Math.max(2, bw * (r.pct / 100))}
                height={BAR_HEIGHT - 4} rx={3}
                fill={fill}
                opacity={isPhase ? 0.65 : 1}
                onMouseMove={e => showTip(e, r)}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: r.kind === 'task' ? 'default' : undefined }}
              />

              {/* % label */}
              <text
                x={LABEL_W + BAR_AREA + 4}
                y={mid + 4}
                fontSize={9}
                fill={isPhase ? '#1e293b' : '#64748b'}
                fontWeight={isPhase ? 600 : 400}
              >
                {r.pct}%
              </text>
            </g>
          )
        })}

        {/* Dependency arrows */}
        {rows.map((r, i) => {
          if (r.kind !== 'task' || !r.deps?.length) return null
          return r.deps.map(depIdStr => {
            const depTask = byId[depIdStr]
            if (!depTask) return null
            const depRowIdx = rowIndexById[depTask.id]
            if (depRowIdx === undefined) return null
            const depRow = rows[depRowIdx]
            const x1 = barX(depRow.offset, total) + barW(depRow.durationDays, total)
            const y1 = rowCenterY(depRowIdx)
            const x2 = barX(r.offset, total)
            const y2 = rowCenterY(i)
            return (
              <path
                key={`${depIdStr}->${r.taskId}`}
                d={`M${x1},${y1} C${x1 + 12},${y1} ${x2 - 12},${y2} ${x2},${y2}`}
                fill="none" stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 2"
                markerEnd="url(#gantt-arr)"
              />
            )
          })
        })}
      </svg>

      {tooltip && (
        <div
          className="absolute z-50 bg-gray-900 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y - 10, maxWidth: 200 }}
        >
          <p className="font-medium truncate">{tooltip.label}</p>
          <p className="text-gray-300 mt-0.5">{tooltip.assignee}</p>
          <p className="text-gray-400 capitalize mt-0.5">{tooltip.status.replace(/_/g, ' ')}</p>
        </div>
      )}
    </div>
  )
}
