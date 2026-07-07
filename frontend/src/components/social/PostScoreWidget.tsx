import type { PostScore } from '../../types'

interface Props {
  score: number // 0-1
  factors: PostScore['factors']
  suggestions: string[]
  loading?: boolean
}

const FACTOR_LABELS: { key: keyof PostScore['factors']; label: string }[] = [
  { key: 'length', label: 'Length' },
  { key: 'hashtags', label: 'Hashtags' },
  { key: 'hook', label: 'Hook' },
  { key: 'cta', label: 'CTA' },
  { key: 'timing', label: 'Timing' },
]

function factorMark(value: number | boolean): { mark: string; cls: string } {
  if (typeof value === 'boolean') {
    return value ? { mark: '✓', cls: 'bg-green-50 text-green-700 border-green-200' }
                 : { mark: '?', cls: 'bg-gray-50 text-gray-400 border-gray-200' }
  }
  if (value >= 1) return { mark: '✓', cls: 'bg-green-50 text-green-700 border-green-200' }
  if (value >= 0.6) return { mark: '~', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
  return { mark: '✕', cls: 'bg-red-50 text-red-600 border-red-200' }
}

export function PostScoreWidget({ score, factors, suggestions, loading }: Props) {
  const pct = Math.round(score * 100)
  const scoreCls = pct > 70 ? 'text-green-600' : pct >= 40 ? 'text-amber-600' : 'text-red-500'
  const barCls = pct > 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-gray-500">Predicted performance</span>
        {loading ? (
          <span className="ml-auto w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className={`ml-auto text-lg font-bold ${scoreCls}`}>{pct}%</span>
        )}
      </div>

      {!loading && (
        <>
          <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${barCls} transition-all`} style={{ width: `${pct}%` }} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {FACTOR_LABELS.map(({ key, label }) => {
              const { mark, cls } = factorMark(factors[key])
              return (
                <span key={key} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
                  {label} {mark}
                </span>
              )
            })}
          </div>

          {suggestions.length > 0 && (
            <ul className="space-y-1 pt-0.5">
              {suggestions.slice(0, 3).map((s, i) => (
                <li key={i} className="text-[11px] text-gray-500 leading-snug flex gap-1.5">
                  <span className="text-amber-400">💡</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
