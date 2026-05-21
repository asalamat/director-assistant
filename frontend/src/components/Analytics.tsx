import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { AnalyticsResponse } from '../types'

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 truncate text-gray-600 text-right">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-gray-500 text-right">{value}</span>
    </div>
  )
}

function Heatmap({ data }: { data: { date: string; count: number }[] }) {
  if (data.length === 0) return null
  const map = new Map(data.map(d => [d.date, d.count]))
  const max = Math.max(...data.map(d => d.count), 1)

  // Build 15-week grid ending today
  const today = new Date()
  const weeks: Date[][] = []
  const start = new Date(today)
  // go back to the most recent Saturday (end of week)
  start.setDate(start.getDate() + (6 - start.getDay()))
  for (let w = 14; w >= 0; w--) {
    const week: Date[] = []
    for (let d = 6; d >= 0; d--) {
      const day = new Date(start)
      day.setDate(start.getDate() - w * 7 - d)
      week.push(day)
    }
    weeks.push(week)
  }

  const cellColor = (count: number) => {
    if (!count) return '#f3f4f6'
    const t = count / max
    if (t < 0.25) return '#dbeafe'
    if (t < 0.5)  return '#93c5fd'
    if (t < 0.75) return '#3b82f6'
    return '#1d4ed8'
  }

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Email Heatmap</h3>
      <div className="border border-gray-200 rounded-xl p-4">
        <div className="flex gap-1">
          <div className="flex flex-col gap-1 mr-1">
            {DAY_LABELS.map((l, i) => (
              <div key={i} className="w-3 h-3 flex items-center justify-center text-[8px] text-gray-400">{l}</div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day, di) => {
                const ds = day.toISOString().slice(0, 10)
                const count = map.get(ds) ?? 0
                return (
                  <div
                    key={di}
                    title={`${ds}: ${count} email${count !== 1 ? 's' : ''}`}
                    className="w-3 h-3 rounded-sm cursor-default transition-opacity hover:opacity-70"
                    style={{ backgroundColor: cellColor(count) }}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-gray-400">
          <span>Less</span>
          {['#f3f4f6', '#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8'].map(c => (
            <div key={c} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  )
}

function Sparkline({ data }: { data: { date: string; count: number }[] }) {
  if (data.length < 2) return <p className="text-xs text-gray-400">Not enough data</p>
  const max = Math.max(...data.map((d) => d.count), 1)
  const w = 400
  const h = 60
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (d.count / max) * h
    return `${x},${y}`
  })
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Analytics() {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setData(await api.getAnalytics(days))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [days])

  const maxSender = data ? Math.max(...data.top_senders.map((s) => s.count), 1) : 1

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Analytics</h2>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <a
            href={`/api/analytics/export.csv?days=${days}`}
            download={`analytics_${days}d.csv`}
            className="text-xs text-gray-400 hover:text-accent transition-colors flex items-center gap-1 border border-gray-200 rounded px-2 py-1 hover:border-accent"
            title="Export as CSV"
          >
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            CSV
          </a>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{data.total_emails.toLocaleString()}</p>
              <p className="text-xs text-blue-500">Total emails</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">
                {Object.values(data.folder_breakdown).reduce((a, b) => a + b, 0) > 0
                  ? Object.keys(data.folder_breakdown).length
                  : 0}
              </p>
              <p className="text-xs text-gray-500">Folders</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">
                {data.daily_volume.length > 0
                  ? Math.round(
                      data.daily_volume.reduce((a, b) => a + b.count, 0) / data.daily_volume.length
                    )
                  : 0}
              </p>
              <p className="text-xs text-gray-500">Avg/day</p>
            </div>
          </div>

          {/* Heatmap */}
          {data.daily_volume.length > 0 && <Heatmap data={data.daily_volume} />}

          {/* Volume sparkline */}
          {data.daily_volume.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Volume Trend
              </h3>
              <div className="border border-gray-200 rounded-xl p-3">
                <Sparkline data={data.daily_volume} />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>{data.daily_volume[0]?.date}</span>
                  <span>{data.daily_volume[data.daily_volume.length - 1]?.date}</span>
                </div>
              </div>
            </div>
          )}

          {/* Top senders */}
          {data.top_senders.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Top Senders
              </h3>
              <div className="space-y-1.5">
                {data.top_senders.map((s) => (
                  <Bar key={s.sender} value={s.count} max={maxSender} label={s.sender} />
                ))}
              </div>
            </div>
          )}

          {/* Folder breakdown */}
          {Object.keys(data.folder_breakdown).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                By Folder
              </h3>
              <div className="space-y-1.5">
                {Object.entries(data.folder_breakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([folder, count]) => (
                    <Bar
                      key={folder}
                      value={count}
                      max={Math.max(...Object.values(data.folder_breakdown))}
                      label={folder}
                    />
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
