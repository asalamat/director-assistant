import { useState } from 'react'
import { api } from '../../api/client'

export function BoardReportTab() {
  const [report, setReport] = useState('')
  const [period, setPeriod] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    setLoading(true); setError(''); setReport('')
    try {
      const r = await api.generateBoardReport()
      setReport(r.report); setPeriod(r.period)
    } catch (e: any) { setError(e.message || 'Failed') }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Board Report</h2>
        <p className="text-xs text-gray-500 mt-0.5">AI-generated executive status report from the past 30 days of email activity.</p>
      </div>
      <button onClick={generate} disabled={loading}
        className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium w-fit">
        {loading ? (
          <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"/>Generating&hellip;</>
        ) : '📋 Generate Board Report'}
      </button>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {report && (
        <div className="border border-gray-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{period}</p>
            <button onClick={() => navigator.clipboard.writeText(report).catch(()=>{})}
              className="text-xs text-gray-400 hover:text-accent border border-gray-200 rounded px-2 py-0.5">Copy</button>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed font-sans">{report}</pre>
        </div>
      )}
    </div>
  )
}
