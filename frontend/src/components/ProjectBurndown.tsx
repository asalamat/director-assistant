import { useMemo } from 'react'

interface BurndownTask {
  id: number
  status: string
  updated_at?: string
  created_at: string
}

interface Props {
  tasks: BurndownTask[]
  createdAt: string
  estimatedWeeks?: number
}

function dateOnly(s: string): string {
  return s ? s.slice(0, 10) : ''
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function ProjectBurndown({ tasks, createdAt, estimatedWeeks = 8 }: Props) {
  const { idealLine, actualLine, dates, totalTasks } = useMemo(() => {
    if (!tasks.length) return { idealLine: [], actualLine: [], dates: [], totalTasks: 0 }

    const start = new Date(dateOnly(createdAt) || new Date().toISOString().slice(0, 10))
    const end = addDays(start, estimatedWeeks * 7)
    const totalDays = Math.max(estimatedWeeks * 7, 1)
    const total = tasks.length

    // Build date axis (sample ~20 points)
    const stepDays = Math.max(1, Math.floor(totalDays / 20))
    const dates: Date[] = []
    for (let d = new Date(start); d <= end; d = addDays(d, stepDays)) {
      dates.push(new Date(d))
    }
    if (dateOnly(dates[dates.length - 1].toISOString()) !== dateOnly(end.toISOString())) {
      dates.push(end)
    }

    // Ideal line: linear from total → 0
    const idealLine = dates.map((d, i) => {
      const progress = i / (dates.length - 1)
      return { date: d, remaining: total * (1 - progress) }
    })

    // Actual line: for each date, count tasks still NOT done by that date
    const doneTasks = tasks
      .filter(t => t.status === 'done' && t.updated_at)
      .map(t => ({ doneDate: new Date(dateOnly(t.updated_at!)) }))
      .sort((a, b) => a.doneDate.getTime() - b.doneDate.getTime())

    const actualLine = dates.map(d => {
      const doneByDate = doneTasks.filter(dt => dt.doneDate <= d).length
      return { date: d, remaining: total - doneByDate }
    })

    return { idealLine, actualLine, dates, totalTasks: total }
  }, [tasks, createdAt, estimatedWeeks])

  if (!totalTasks) return null

  // SVG dimensions
  const W = 360
  const H = 160
  const PAD = { top: 12, right: 12, bottom: 28, left: 36 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const xScale = (i: number, len: number) => PAD.left + (i / (len - 1)) * chartW
  const yScale = (remaining: number) => PAD.top + (1 - remaining / totalTasks) * chartH

  const toPath = (points: { date: Date; remaining: number }[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i, points.length).toFixed(1)},${yScale(p.remaining).toFixed(1)}`).join(' ')

  // X axis labels — show ~4 dates
  const labelStep = Math.max(1, Math.floor(dates.length / 4))
  const xLabels = dates.filter((_, i) => i % labelStep === 0 || i === dates.length - 1)

  return (
    <div className="pt-4 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-700 mb-2">Burndown Chart</p>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = yScale(totalTasks * pct)
          return (
            <g key={pct}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
                stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3,3" />
              <text x={PAD.left - 4} y={y + 4} fontSize="8" fill="#9ca3af" textAnchor="end">
                {Math.round(totalTasks * (1 - pct))}
              </text>
            </g>
          )
        })}

        {/* Ideal line (blue) */}
        <path d={toPath(idealLine)} fill="none" stroke="#3b82f6" strokeWidth="1.5"
          strokeDasharray="4,3" opacity="0.7" />

        {/* Actual line (green) */}
        <path d={toPath(actualLine)} fill="none" stroke="#10b981" strokeWidth="2" />

        {/* Actual area fill */}
        <path
          d={`${toPath(actualLine)} L${xScale(actualLine.length - 1, actualLine.length).toFixed(1)},${(PAD.top + chartH).toFixed(1)} L${PAD.left},${(PAD.top + chartH).toFixed(1)} Z`}
          fill="#10b981" opacity="0.07" />

        {/* X axis */}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + chartH} y2={PAD.top + chartH}
          stroke="#d1d5db" strokeWidth="1" />

        {/* X labels */}
        {xLabels.map(d => {
          const idx = dates.findIndex(dt => dt.getTime() === d.getTime())
          const x = xScale(idx, dates.length)
          const label = `${d.getMonth() + 1}/${d.getDate()}`
          return (
            <text key={d.getTime()} x={x} y={PAD.top + chartH + 12} fontSize="8"
              fill="#9ca3af" textAnchor="middle">{label}</text>
          )
        })}

        {/* Legend */}
        <line x1={W - 80} x2={W - 68} y1={10} y2={10} stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,3" />
        <text x={W - 65} y={13} fontSize="8" fill="#6b7280">Ideal</text>
        <line x1={W - 45} x2={W - 33} y1={10} y2={10} stroke="#10b981" strokeWidth="2" />
        <text x={W - 30} y={13} fontSize="8" fill="#6b7280">Actual</text>
      </svg>
    </div>
  )
}
