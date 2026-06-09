import { useState, useEffect } from 'react'
import { api } from '../api/client'

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

export function ReportScheduleSettings() {
  const [enabled, setEnabled] = useState(false)
  const [day, setDay] = useState('monday')
  const [time, setTime] = useState('07:00')
  const [emailTo, setEmailTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState('')

  useEffect(() => {
    fetch('/api/report/status').then(r => r.json()).then((s: any) => {
      setEnabled(s.enabled || false)
      setEmailTo(s.email_to || '')
      if (s.schedule) {
        const parts = s.schedule.split(':')
        if (parts[0]) setDay(parts[0])
        if (parts[1] && parts[2]) setTime(`${parts[1]}:${parts[2]}`)
      }
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    const schedule = `${day}:${time}`
    await (api.saveConfig as any)({
      report_email_enabled: enabled,
      report_email_schedule: schedule,
      report_email_to: emailTo,
    }).catch(() => {})
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const sendNow = async () => {
    setSending(true); setSendMsg('')
    try {
      const r = await fetch('/api/report/send-now', { method: 'POST' }).then(r => r.json())
      setSendMsg(r.queued ? `✓ Queued — sending to ${r.sent_to}` : `✗ ${r.detail || 'Failed'}`)
    } catch (e: any) { setSendMsg(`✗ ${e.message}`) }
    setSending(false)
    setTimeout(() => setSendMsg(''), 5000)
  }

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-lg">📬</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800">Scheduled Weekly Brief Email</p>
            <p className="text-xs text-gray-400 mt-0.5">Auto-email your weekly brief on a recurring schedule</p>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer flex-shrink-0">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-accent"/>
            <span className="text-xs text-gray-600">Enable</span>
          </label>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-400">Day</label>
            <select value={day} onChange={e => setDay(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mt-0.5 focus:outline-none bg-white">
              {DAYS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-400">Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-400">Send to</label>
          <input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)}
            placeholder="you@example.com"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Schedule'}
        </button>
        <button onClick={sendNow} disabled={sending || !emailTo.trim()}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {sending ? '…' : '📬 Send now'}
        </button>
        {sendMsg && <span className={`text-xs ${sendMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{sendMsg}</span>}
      </div>
    </div>
  )
}
