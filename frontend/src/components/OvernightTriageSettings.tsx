import { useState, useEffect } from 'react'
import { api } from '../api/client'

export function OvernightTriageSettings() {
  const [enabled, setEnabled] = useState(false)
  const [hour, setHour] = useState(23)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.getConfig().then((cfg: any) => {
      setEnabled(!!cfg.overnight_triage_enabled)
      setHour(cfg.overnight_triage_hour ?? 23)
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    await (api.saveConfig as any)({ overnight_triage_enabled: enabled, overnight_triage_hour: hour }).catch(() => {})
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const runNow = async () => {
    setRunning(true); setMsg('')
    try {
      await fetch('/api/overnight/run-now', { method: 'POST' }).then(r => r.json())
      setMsg('Running — drafts will appear in 1-2 minutes in Actions > Overnight')
      setTimeout(() => setMsg(''), 10000)
    } catch { setMsg('Failed to trigger') }
    setRunning(false)
  }

  const fmt = (h: number) => {
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:00 ${ampm}`
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-lg">💤</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-800">Overnight Triage Agent</p>
          <p className="text-xs text-gray-400 mt-0.5">AI drafts replies to unread emails at night, you approve in the morning</p>
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer flex-shrink-0">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-accent"/>
          <span className="text-xs text-gray-600">Enable</span>
        </label>
      </div>
      <div>
        <label className="text-xs text-gray-400">Run time</label>
        <select value={hour} onChange={e => setHour(Number(e.target.value))}
          className="w-full mt-0.5 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none bg-white">
          {Array.from({length: 24}, (_, i) => (
            <option key={i} value={i}>{fmt(i)}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        </button>
        <button onClick={runNow} disabled={running}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {running ? '...' : 'Run now'}
        </button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
    </div>
  )
}
