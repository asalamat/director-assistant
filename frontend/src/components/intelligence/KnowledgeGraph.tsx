import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../../api/client'

type NodeType = 'person' | 'topic' | 'project'

interface GraphNode {
  id: string
  label: string
  type: NodeType
  count: number
  // physics
  x: number
  y: number
  vx: number
  vy: number
}

interface GraphEdge {
  source: string
  target: string
  weight: number
}

const NODE_COLOR: Record<NodeType, { fill: string; stroke: string; text: string }> = {
  person:  { fill: '#dbeafe', stroke: '#3b82f6', text: '#1d4ed8' },
  topic:   { fill: '#fef3c7', stroke: '#f59e0b', text: '#92400e' },
  project: { fill: '#d1fae5', stroke: '#10b981', text: '#065f46' },
}

const NODE_LEGEND: { type: NodeType; label: string }[] = [
  { type: 'person',  label: 'Person' },
  { type: 'topic',   label: 'Topic'  },
  { type: 'project', label: 'Project' },
]

function nodeRadius(count: number): number {
  return Math.max(10, Math.min(28, Math.sqrt(count + 1) * 3.5))
}

export function KnowledgeGraph({ onSearchPerson }: { onSearchPerson?: (name: string) => void }) {
  const [rawNodes, setRawNodes] = useState<{ id: string; label: string; type: NodeType; count: number }[]>([])
  const [rawEdges, setRawEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const rafRef = useRef<number>(0)
  const [tick, setTick] = useState(0)

  const W = 800
  const H = 540

  // Fetch data
  useEffect(() => {
    setLoading(true)
    api.getRagKnowledgeGraph()
      .then(data => {
        if (data.error && !data.nodes.length) {
          setError(data.error)
        } else {
          setRawNodes(data.nodes)
          setRawEdges(data.edges)
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Initialise physics nodes
  useEffect(() => {
    if (!rawNodes.length) return
    nodesRef.current = rawNodes.map((n, i) => {
      const angle = (i / rawNodes.length) * Math.PI * 2
      const r = 160 + Math.random() * 60
      return {
        ...n,
        x: W / 2 + Math.cos(angle) * r,
        y: H / 2 + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      }
    })
    startSimulation()
    return () => cancelAnimationFrame(rafRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes, rawEdges])

  const startSimulation = useCallback(() => {
    let iteration = 0
    const maxIter = 300

    const edgeMap: Record<string, string[]> = {}
    for (const e of rawEdges) {
      edgeMap[e.source] = edgeMap[e.source] || []
      edgeMap[e.source].push(e.target)
      edgeMap[e.target] = edgeMap[e.target] || []
      edgeMap[e.target].push(e.source)
    }

    const edgeWeightMap: Record<string, number> = {}
    for (const e of rawEdges) {
      const key = [e.source, e.target].sort().join('|')
      edgeWeightMap[key] = e.weight
    }

    const step = () => {
      const nodes = nodesRef.current
      if (!nodes.length) return

      const alpha = Math.max(0.01, 1 - iteration / maxIter)
      const REPEL = 1800
      const ATTRACT = 0.04
      const CENTER = 0.006
      const DAMPEN = 0.85

      // Repulsion between all pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x
          const dy = nodes[j].y - nodes[i].y
          const dist2 = dx * dx + dy * dy + 1
          const dist = Math.sqrt(dist2)
          const force = REPEL / dist2
          const fx = (dx / dist) * force * alpha
          const fy = (dy / dist) * force * alpha
          nodes[i].vx -= fx
          nodes[i].vy -= fy
          nodes[j].vx += fx
          nodes[j].vy += fy
        }
      }

      // Spring attraction along edges
      const nodeById: Record<string, GraphNode> = {}
      for (const n of nodes) nodeById[n.id] = n

      for (const e of rawEdges) {
        const a = nodeById[e.source]
        const b = nodeById[e.target]
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const idealLen = 120 / (e.weight * 0.5 + 0.5)
        const stretch = (dist - idealLen) * ATTRACT * alpha
        const fx = (dx / dist) * stretch
        const fy = (dy / dist) * stretch
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      // Gravity toward center
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * CENTER * alpha
        n.vy += (H / 2 - n.y) * CENTER * alpha
        n.vx *= DAMPEN
        n.vy *= DAMPEN
        n.x += n.vx
        n.y += n.vy
        // Clamp to canvas
        const pad = nodeRadius(n.count) + 8
        n.x = Math.max(pad, Math.min(W - pad, n.x))
        n.y = Math.max(pad, Math.min(H - pad, n.y))
      }

      iteration++
      setTick(t => t + 1)
      if (iteration < maxIter) {
        rafRef.current = requestAnimationFrame(step)
      }
    }

    rafRef.current = requestAnimationFrame(step)
  }, [rawEdges])

  const nodes = nodesRef.current
  const nodeById: Record<string, GraphNode> = {}
  for (const n of nodes) nodeById[n.id] = n

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Building knowledge graph...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        {error}
      </div>
    )
  }

  if (!rawNodes.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400 text-sm">
        <span className="text-3xl">🕸</span>
        <span>No graph data yet. Import emails to populate the knowledge graph.</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 flex-shrink-0">
        <div>
          <span className="text-sm font-semibold text-gray-700">Knowledge Graph</span>
          <span className="ml-2 text-xs text-gray-400">
            {nodes.length} nodes · {rawEdges.length} edges
          </span>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3">
          {NODE_LEGEND.map(({ type, label }) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-full border"
                style={{ background: NODE_COLOR[type].fill, borderColor: NODE_COLOR[type].stroke }}
              />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Graph canvas */}
      <div className="relative flex-1 overflow-hidden bg-gray-50">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-full"
          style={{ cursor: 'default' }}
        >
          {/* Edges */}
          {rawEdges.map((e, i) => {
            const a = nodeById[e.source]
            const b = nodeById[e.target]
            if (!a || !b) return null
            return (
              <line
                key={i}
                x1={a.x} y1={a.y}
                x2={b.x} y2={b.y}
                stroke="#d1d5db"
                strokeWidth={Math.min(3, e.weight * 0.8 + 0.5)}
                strokeOpacity={Math.min(0.8, 0.2 + e.weight * 0.15)}
              />
            )
          })}

          {/* Nodes */}
          {nodes.map(n => {
            const r = nodeRadius(n.count)
            const col = NODE_COLOR[n.type]
            return (
              <g
                key={n.id}
                style={{ cursor: n.type === 'person' ? 'pointer' : 'default' }}
                onMouseEnter={evt => {
                  const rect = svgRef.current?.getBoundingClientRect()
                  if (!rect) return
                  setTooltip({
                    x: evt.clientX - rect.left,
                    y: evt.clientY - rect.top,
                    node: n,
                  })
                }}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => {
                  if (n.type === 'person' && onSearchPerson) {
                    onSearchPerson(n.label)
                  }
                }}
              >
                <circle
                  cx={n.x} cy={n.y} r={r}
                  fill={col.fill}
                  stroke={col.stroke}
                  strokeWidth="1.5"
                />
                <text
                  x={n.x} y={n.y + r + 10}
                  textAnchor="middle"
                  fontSize="8"
                  fill="#6b7280"
                  className="select-none pointer-events-none"
                >
                  {n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-10 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs pointer-events-none"
            style={{
              left: Math.min(tooltip.x + 12, W - 160),
              top: Math.max(8, tooltip.y - 40),
            }}
          >
            <div className="font-semibold text-gray-800">{tooltip.node.label}</div>
            <div className="text-gray-500 capitalize">{tooltip.node.type}</div>
            <div className="text-gray-400">
              {tooltip.node.type === 'person'
                ? `${tooltip.node.count} emails`
                : tooltip.node.type === 'topic'
                ? `${tooltip.node.count} occurrences`
                : 'Project'}
            </div>
            {tooltip.node.type === 'person' && onSearchPerson && (
              <div className="mt-1 text-blue-500">Click to search emails</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
