import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { api } from '../../api/client'

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

const ZOOM_IN_FACTOR  = 1.15
const ZOOM_OUT_FACTOR = 0.87
const MIN_SCALE = 0.3
const MAX_SCALE = 8

interface TooltipState {
  visible: boolean
  x: number
  y: number
  point: MapPoint | null
}

interface Transform {
  x: number
  y: number
  scale: number
}

const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalize(values: number[], padLow: number, padHigh: number): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map(v => padLow + ((v - min) / range) * (padHigh - padLow))
}

export function EmbeddingMap({ onSearch }: { onSearch?: (subject: string) => void }) {
  const [points, setPoints]         = useState<MapPoint[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [tooltip, setTooltip]       = useState<TooltipState>({ visible: false, x: 0, y: 0, point: null })
  const [filter, setFilter]         = useState<string>('all')
  const [classifying, setClassifying] = useState(false)
  const [classifyMsg, setClassifyMsg] = useState('')
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [explanation, setExplanation] = useState('')
  const [explaining, setExplaining]   = useState(false)
  const explainAbortRef               = useRef<AbortController | null>(null)

  // Zoom + pan state
  const [transform, setTransform]   = useState<Transform>(IDENTITY_TRANSFORM)
  const [dragging, setDragging]     = useState(false)
  const dragStart = useRef<{ clientX: number; clientY: number; tx: number; ty: number } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)

  const isTransformed = transform.x !== 0 || transform.y !== 0 || transform.scale !== 1

  const loadMap = () => {
    setLoading(true)
    setError(null)
    api.getRagEmbeddings2d()
      .then(res => {
        if (res.error && !res.points?.length) setError(res.error)
        else setPoints(res.points || [])
      })
      .catch(err => setError(err.message || 'Failed to load map'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadMap() }, [])

  const handleClassify = async () => {
    setClassifying(true)
    setClassifyMsg('')
    try {
      const r = await api.classifyBatch()
      setClassifyMsg(`Classified ${r.classified} emails`)
      setTimeout(() => { setClassifyMsg(''); loadMap() }, 1500)
    } catch { setClassifyMsg('Failed') }
    finally { setClassifying(false) }
  }

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

  function handleDotClick(e: React.MouseEvent, p: MapPoint) {
    e.stopPropagation()
    if (e.shiftKey) {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(p.id)) next.delete(p.id)
        else next.add(p.id)
        return next
      })
    } else {
      if (onSearch) onSearch(p.subject)
    }
  }

  function clearSelection() {
    setSelected(new Set())
    setExplanation('')
    explainAbortRef.current?.abort()
  }

  function handleExplain() {
    if (selected.size < 2) return
    explainAbortRef.current?.abort()
    setExplanation('')
    setExplaining(true)
    explainAbortRef.current = api.streamExplainCluster(
      Array.from(selected),
      (text) => setExplanation(prev => prev + text),
      () => setExplaining(false),
    )
  }

  const selectedCount = useMemo(() => selected.size, [selected])

  // Tooltip: mouse coords in client space; we show the tooltip overlay at client coords
  // (tooltip is positioned in the parent div, not inside the SVG transform group)
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

  function handleMouseLeaveCircle() {
    setTooltip(t => ({ ...t, visible: false }))
  }

  // Wheel zoom: zoom centered on the SVG viewport (not the cursor — keeps it simple)
  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR
    setTransform(t => ({
      ...t,
      scale: clamp(t.scale * factor, MIN_SCALE, MAX_SCALE),
    }))
  }, [])

  // Drag-to-pan
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Only initiate pan on left button, and not if a circle was the target
    if (e.button !== 0) return
    e.preventDefault()
    dragStart.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      tx: transform.x,
      ty: transform.y,
    }
    setDragging(true)
  }, [transform.x, transform.y])

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragStart.current) return
    const dx = e.clientX - dragStart.current.clientX
    const dy = e.clientY - dragStart.current.clientY
    setTransform(t => ({
      ...t,
      x: dragStart.current!.tx + dx,
      y: dragStart.current!.ty + dy,
    }))
    // Hide tooltip while panning
    setTooltip(prev => ({ ...prev, visible: false }))
  }, [])

  const handleMouseUp = useCallback(() => {
    dragStart.current = null
    setDragging(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    dragStart.current = null
    setDragging(false)
    setTooltip(prev => ({ ...prev, visible: false }))
  }, [])

  const resetZoom = useCallback(() => {
    setTransform(IDENTITY_TRANSFORM)
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
        <div className="w-6 h-6 border-2 border-accent-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Projecting email embeddings...</span>
      </div>
    )
  }

  if (error) {
    const isLoading = error.toLowerCase().includes('loading') || error.toLowerCase().includes('available')
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 px-8 text-center">
        <span className="text-2xl">🗺</span>
        <p className="text-sm font-medium text-gray-500">{error}</p>
        {isLoading ? (
          <p className="text-xs text-gray-400">The RAG worker is still starting up. Click Retry in a few seconds.</p>
        ) : (
          <p className="text-xs text-gray-400">Index at least a few emails and make sure the RAG worker is ready.</p>
        )}
        <button
          onClick={loadMap}
          className="mt-1 text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded hover:bg-gray-50 transition-colors"
        >
          ↻ Retry
        </button>
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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Selection controls */}
          {selectedCount > 0 && (
            <>
              <span className="text-xs font-medium text-accent-600 bg-accent-50 border border-accent-200 px-2 py-0.5 rounded-full">
                {selectedCount} selected
              </span>
              <button
                onClick={handleExplain}
                disabled={explaining || selectedCount < 2}
                className="text-xs bg-accent-500 text-white px-2.5 py-1 rounded hover:bg-accent-600 disabled:opacity-50 transition-colors"
              >
                {explaining ? '⟳ Explaining…' : '✦ Explain cluster'}
              </button>
              <button
                onClick={clearSelection}
                title="Clear selection"
                className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-1 rounded hover:bg-gray-100 transition-colors"
              >
                ✕
              </button>
            </>
          )}
          {/* Reset zoom button — only shown when transformed */}
          {isTransformed && (
            <button
              onClick={resetZoom}
              title="Reset zoom and pan"
              className="text-xs border border-gray-200 text-gray-600 px-2.5 py-1 rounded hover:bg-gray-50 transition-colors"
            >
              ⊙ Reset zoom
            </button>
          )}
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
          <button
            onClick={handleClassify}
            disabled={classifying}
            title="AI-classify unclassified emails to add color coding"
            className="text-xs border border-gray-200 text-gray-600 px-2.5 py-1 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {classifying ? '⟳ Classifying…' : '🏷 Classify emails'}
          </button>
          {classifyMsg && <span className="text-xs text-green-600">{classifyMsg}</span>}
        </div>
      </div>

      {/* SVG map */}
      <div className="flex-1 overflow-hidden relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-full"
          style={{
            display: 'block',
            cursor: dragging ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {/* Faint grid — outside the transform group so it stays anchored */}
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

          {/* Zoom + pan group — all dots live inside this */}
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
            {visible.map(p => {
              const color = CATEGORY_COLORS[p.category] ?? DEFAULT_COLOR
              const isSel = selected.has(p.id)
              return (
                <circle
                  key={p.id}
                  cx={p.sx}
                  cy={p.sy}
                  r={isSel ? 7 : 5}
                  fill={color}
                  fillOpacity={isSel ? 1 : 0.75}
                  stroke={isSel ? '#1d4ed8' : 'white'}
                  strokeWidth={isSel ? 2 : 1}
                  style={{ cursor: 'pointer' }}
                  onClick={e => handleDotClick(e, p)}
                  onMouseEnter={e => handleMouseEnter(e, p)}
                  onMouseLeave={handleMouseLeaveCircle}
                />
              )
            })}
          </g>
        </svg>

        {/* Tooltip — positioned in client/container space, unaffected by SVG transform */}
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
            <p className="text-[10px] text-gray-400 mt-1">
              {onSearch ? 'Click to search' : ''} · Shift+click to select
            </p>
          </div>
        )}
      </div>

      {/* Explain cluster panel */}
      {explanation && (
        <div className="px-4 py-3 border-t border-accent-100 bg-accent-50 flex-shrink-0 max-h-32 overflow-y-auto">
          <p className="text-[11px] font-semibold text-accent-700 mb-1">✦ Cluster Analysis</p>
          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{explanation}</p>
        </div>
      )}

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
        {isTransformed && (
          <span className="text-[10px] text-gray-400 ml-auto">
            {Math.round(transform.scale * 100)}% zoom
          </span>
        )}
      </div>
    </div>
  )
}
