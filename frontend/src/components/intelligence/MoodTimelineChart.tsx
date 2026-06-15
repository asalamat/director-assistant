import { useState, useEffect, useRef } from 'react'
import { api } from '../../api/client'

type DayPoint = {
  date: string
  score: number
  count: number
  dominant_category: string
}

type TooltipState = {
  x: number
  y: number
  point: DayPoint
} | null

const W = 520
const H = 120
const PAD = { top: 12, right: 16, bottom: 28, left: 32 }

const CHART_W = W - PAD.left - PAD.right
const CHART_H = H - PAD.top - PAD.bottom

const MIN_SCORE = 1
const MAX_SCORE = 3

function scoreColor(score: number): string {
  if (score < 1.8) return '#22c55e'   // green
  if (score <= 2.3) return '#f59e0b'  // amber
  return '#ef4444'                    // red
}

function toX(index: number, total: number): number {
  if (total <= 1) return PAD.left + CHART_W / 2
  return PAD.left + (index / (total - 1)) * CHART_W
}

function toY(score: number): number {
  const t = (score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)
  return PAD.top + CHART_H - t * CHART_H
}

function formatLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay()
}

export function MoodTimelineChart({ days = 30 }: { days?: number }) {
  const [data, setData] = useState<DayPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getMoodTimeline(days)
      .then(setData)
      .catch(() => setError('Could not load mood timeline'))
      .finally(() => setLoading(false))
  }, [days])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-xs py-4">
        <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        Loading mood timeline…
      </div>
    )
  }

  if (error) {
    return <p className="text-xs text-red-400 py-2">{error}</p>
  }

  if (data.length < 2) {
    return <p className="text-xs text-gray-400 py-2">Not enough data for mood timeline.</p>
  }

  // Build polyline segments coloured by score
  const segments: { pts: string; color: string }[] = []
  for (let i = 0; i < data.length - 1; i++) {
    const x1 = toX(i, data.length)
    const y1 = toY(data[i].score)
    const x2 = toX(i + 1, data.length)
    const y2 = toY(data[i + 1].score)
    const midScore = (data[i].score + data[i + 1].score) / 2
    segments.push({ pts: `${x1},${y1} ${x2},${y2}`, color: scoreColor(midScore) })
  }

  // Y-axis ticks
  const yTicks = [
    { score: 1, label: 'Low' },
    { score: 2, label: 'Med' },
    { score: 3, label: 'High' },
  ]

  // X-axis labels: show Mon/Wed/Fri only
  const xLabels = data
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => {
      const dow = dayOfWeek(d.date)
      return dow === 1 || dow === 3 || dow === 5
    })

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * W
    const chartX = mouseX - PAD.left
    if (chartX < 0 || chartX > CHART_W) {
      setTooltip(null)
      return
    }
    const idx = Math.round((chartX / CHART_W) * (data.length - 1))
    const clamped = Math.max(0, Math.min(data.length - 1, idx))
    const point = data[clamped]
    const px = toX(clamped, data.length)
    const py = toY(point.score)
    setTooltip({ x: px, y: py, point })
  }

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 120 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Y axis */}
        {yTicks.map(({ score, label }) => {
          const y = toY(score)
          return (
            <g key={score}>
              <line
                x1={PAD.left} y1={y}
                x2={PAD.left + CHART_W} y2={y}
                stroke="#e5e7eb" strokeWidth="1"
              />
              <text
                x={PAD.left - 4} y={y + 3.5}
                textAnchor="end" fontSize="7" fill="#9ca3af"
              >
                {label}
              </text>
            </g>
          )
        })}

        {/* X axis labels (Mon/Wed/Fri) */}
        {xLabels.map(({ d, i }) => (
          <text
            key={d.date}
            x={toX(i, data.length)}
            y={H - 4}
            textAnchor="middle"
            fontSize="7"
            fill="#9ca3af"
          >
            {formatLabel(d.date)}
          </text>
        ))}

        {/* Coloured line segments */}
        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg.pts}
            fill="none"
            stroke={seg.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Data dots */}
        {data.map((d, i) => (
          <circle
            key={d.date}
            cx={toX(i, data.length)}
            cy={toY(d.score)}
            r="2.5"
            fill={scoreColor(d.score)}
            stroke="white"
            strokeWidth="1"
          />
        ))}

        {/* Hover crosshair + highlighted dot */}
        {tooltip && (
          <>
            <line
              x1={tooltip.x} y1={PAD.top}
              x2={tooltip.x} y2={PAD.top + CHART_H}
              stroke="#6b7280" strokeWidth="1" strokeDasharray="3,2"
            />
            <circle
              cx={tooltip.x} cy={tooltip.y}
              r="4"
              fill={scoreColor(tooltip.point.score)}
              stroke="white" strokeWidth="1.5"
            />
          </>
        )}
      </svg>

      {/* Tooltip box */}
      {tooltip && (() => {
        const p = tooltip.point
        const isRightHalf = tooltip.x > W / 2
        return (
          <div
            className="absolute pointer-events-none z-10 bg-white border border-gray-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs"
            style={{
              top: 0,
              left: isRightHalf ? undefined : `calc(${(tooltip.x / W) * 100}% + 8px)`,
              right: isRightHalf ? `calc(${((W - tooltip.x) / W) * 100}% + 8px)` : undefined,
            }}
          >
            <p className="font-semibold text-gray-700">{formatLabel(p.date)}</p>
            <p className="text-gray-500">Score: <span className="font-semibold" style={{ color: scoreColor(p.score) }}>{p.score.toFixed(2)}</span></p>
            <p className="text-gray-400">{p.count} email{p.count !== 1 ? 's' : ''}</p>
            <p className="text-gray-400 capitalize">{p.dominant_category.replace(/_/g, ' ')}</p>
          </div>
        )
      })()}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-1.5 rounded-full bg-green-500" /> Low
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-1.5 rounded-full bg-amber-400" /> Medium
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-1.5 rounded-full bg-red-500" /> High urgency
        </span>
      </div>
    </div>
  )
}
