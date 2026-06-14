import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { EmailCategory } from '../../types'

interface MapPoint {
  id: string
  x: number
  y: number
  subject: string
  sender: string
  category: string
  date: string
}

// Category dot colors — solid hex values for SVG fill
const CATEGORY_COLORS: Record<string, string> = {
  proposal:        '#3b82f6', // blue-500
  contract:        '#6366f1', // indigo-500
  invoice:         '#f59e0b', // yellow-500
  meeting:         '#14b8a6', // teal-500
  action_required: '#f97316', // orange-500
  fyi:             '#9ca3af', // gray-400
  newsletter:      '#94a3b8', // slate-400
  other:           '#d1d5db', // gray-300
}

const CATEGORY_LABELS: Record<string, string> = {
  proposal:        'Proposal',
  contract:        'Contract',
  invoice:         'Invoice',
  meeting:         'Meeting',
  action_required: 'Action',
  fyi:             'FYI',
  newsletter:      'Newsletter',
  other:           'Other',
}

const DEFAULT_COLOR = '#9ca3af'

const SVG_W = 700
const SVG_H = 480
const PAD   = 32

interface TooltipState {
  visible: boolean
  x: number
  y: number
  point: MapPoint | null
}

function normalize(values: number[], padLow: number, padHigh: number): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map(v => padLow + ((v - min) / range) * (padHigh - padLow))
}

export function EmbeddingMap({ onSearch }: { onSearch?: (subject: string) => void }) {
  const [points, setPoints]     = useState<MapPoint[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [tooltip, setTooltip]   = useState<TooltipState>({ visible: false, x: 0, y: 0, point: null })
  const [filter, setFilter]     = useState<string>('all')
  const svgRef                  = useRef<SVGSVGElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getRagEmbeddings2d()
      .then(res => {
        if (res.error && !res.points?.length) {
          setError(res.error)
        } else {
          setPoints(res.points || [])
        }
      })
      .catch(err => setError(err.message || 'Failed to load map'))
      .finally(() => setLoading(false))
  }, [])

  // Project raw PCA coords to SVG space
  const rawX = points.map(p => p.x)
  const rawY = points.map(p => p.y)
  const svgXs = rawX.length ? normalize(rawX, PAD, SVG_W - PAD) : []
  const svgYs = rawY.length ? normalize(rawY, PAD, SVG_H - PAD) : []

  const projected = points.map((p, i) => ({
    ...p,
    sx: svgXs[i] ?? 0,
    sy: svgYs[i] ?? 0,
  }))

  const visible = filter === 'all'
    ? projected
    : projected.filter(p => (p.category || 'other') === filter)

  // Unique categories in the dataset for the legend/filter
  const presentCategories = Array.from(new Set(points.map(p => p.category || 'other')))

  function handleDotClick(p: MapPoint) {
    if (onSearch) onSearch(p.subject)
  }

  function handleMouseEnter(e: React.MouseEvent<SVGCircleElement>, p: typeof projected[0]) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    setTooltip({
      visible: true,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      point: p,
    })
  }

  function handleMouseLeave() {
    setTooltip(t => ({ ...t, visible: false }))
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
        <div className="w-6 h-6 border-2 border-accent-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Projecting email embeddings...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400 px-8 text-center">
        <span className="text-2xl">🗺</span>
        <p className="text-sm font-medium text-gray-500">{error}</p>
        <p className="text-xs text-gray-400">Index at least a few emails and make sure the RAG worker is ready.</p>
      </div>
    )
  }

  if (!points.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
        <span className="text-2xl">🗺</span>
        <p className="text-sm">No indexed emails to map yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Email Cluster Map</h2>
          <p className="text-[11px] text-gray-400">{points.length} emails projected to 2D via PCA</p>
        </div>
        {/* Category filter */}
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 bg-white"
        >
          <option value="all">All categories</option>
          {presentCategories.map(c => (
            <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
          ))}
        </select>
      </div>

      {/* SVG map */}
      <div className="flex-1 overflow-hidden relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-full"
          style={{ display: 'block' }}
        >
          {/* Faint grid */}
          {[0.25, 0.5, 0.75].map(f => (
            <g key={f}>
              <line
                x1={PAD + f * (SVG_W - 2 * PAD)} y1={PAD}
                x2={PAD + f * (SVG_W - 2 * PAD)} y2={SVG_H - PAD}
                stroke="#e5e7eb" strokeWidth={1}
              />
              <line
                x1={PAD} y1={PAD + f * (SVG_H - 2 * PAD)}
                x2={SVG_W - PAD} y2={PAD + f * (SVG_H - 2 * PAD)}
                stroke="#e5e7eb" strokeWidth={1}
              />
            </g>
          ))}

          {/* Dots */}
          {visible.map(p => {
            const color = CATEGORY_COLORS[p.category] ?? DEFAULT_COLOR
            return (
              <circle
                key={p.id}
                cx={p.sx}
                cy={p.sy}
                r={5}
                fill={color}
                fillOpacity={0.75}
                stroke="white"
                strokeWidth={1}
                style={{ cursor: onSearch ? 'pointer' : 'default' }}
                onClick={() => handleDotClick(p)}
                onMouseEnter={e => handleMouseEnter(e, p)}
                onMouseLeave={handleMouseLeave}
              />
            )
          })}
        </svg>

        {/* Tooltip */}
        {tooltip.visible && tooltip.point && (
          <div
            className="absolute z-10 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 max-w-[220px]"
            style={{
              left: Math.min(tooltip.x + 12, SVG_W - 240),
              top: Math.max(tooltip.y - 40, 8),
            }}
          >
            <p className="text-[11px] font-semibold text-gray-800 truncate">{tooltip.point.subject || '(no subject)'}</p>
            <p className="text-[10px] text-gray-500 truncate">{tooltip.point.sender}</p>
            {tooltip.point.date && (
              <p className="text-[10px] text-gray-400">{tooltip.point.date.slice(0, 10)}</p>
            )}
            {tooltip.point.category && (
              <p
                className="text-[10px] font-medium mt-0.5"
                style={{ color: CATEGORY_COLORS[tooltip.point.category] ?? '#6b7280' }}
              >
                {CATEGORY_LABELS[tooltip.point.category] ?? tooltip.point.category}
              </p>
            )}
            {onSearch && (
              <p className="text-[10px] text-accent-500 mt-1">Click to search</p>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2 border-t border-gray-100 flex-shrink-0">
        {presentCategories.map(c => (
          <button
            key={c}
            onClick={() => setFilter(filter === c ? 'all' : c)}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-800 transition-colors"
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: CATEGORY_COLORS[c] ?? DEFAULT_COLOR }}
            />
            {CATEGORY_LABELS[c] ?? c}
          </button>
        ))}
      </div>
    </div>
  )
}
