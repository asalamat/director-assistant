import { useState, useEffect } from 'react'
import { api } from '../api/client'

const EVENTS = [
  { id: 'new_email', label: 'New email received' },
  { id: 'vip_alert', label: 'VIP contact emails you' },
  { id: 'action_created', label: 'Action item created' },
  { id: 'weekly_brief_ready', label: 'Weekly brief generated' },
]

export function WebhooksSettings() {
  const [urls, setUrls] = useState<string[]>(['', '', ''])
  const [events, setEvents] = useState<string[]>(['new_email', 'vip_alert', 'action_created'])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testUrl, setTestUrl] = useState('')
  const [testResult, setTestResult] = useState<{ok: boolean; status_code?: number; error?: string} | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    api.getConfig().then(cfg => {
      if (cfg.webhook_urls) setUrls([...(cfg.webhook_urls as string[]), '', '', ''].slice(0, 3))
      if (cfg.webhook_events) setEvents(cfg.webhook_events as string[])
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    const cleanUrls = urls.filter(u => u.trim())
    await api.saveConfig({ webhook_urls: cleanUrls, webhook_events: events } as any).catch(() => {})
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const testWebhook = async () => {
    if (!testUrl.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: testUrl }),
      })
      setTestResult(await r.json())
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message })
    }
    setTesting(false)
  }

  const toggleEvent = (id: string) =>
    setEvents(prev => prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id])

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Webhook URLs (up to 3)</p>
        <p className="text-xs text-gray-400 mb-3">Add Zapier, Make, n8n, or any custom URL. Each receives a JSON POST when events fire.</p>
        {urls.map((url, i) => (
          <input key={i} value={url}
            onChange={e => { const n = [...urls]; n[i] = e.target.value; setUrls(n) }}
            placeholder={`Webhook URL ${i + 1}`}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Trigger Events</p>
        {EVENTS.map(ev => (
          <label key={ev.id} className="flex items-center gap-2 py-1 cursor-pointer">
            <input type="checkbox" checked={events.includes(ev.id)}
              onChange={() => toggleEvent(ev.id)} className="accent-accent" />
            <span className="text-sm text-gray-700">{ev.label}</span>
          </label>
        ))}
      </div>

      <button onClick={save} disabled={saving}
        className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Webhooks'}
      </button>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Test a Webhook</p>
        <div className="flex gap-2">
          <input value={testUrl} onChange={e => setTestUrl(e.target.value)}
            placeholder="Paste a webhook URL to test…"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button onClick={testWebhook} disabled={testing || !testUrl.trim()}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            {testing ? '…' : 'Test'}
          </button>
        </div>
        {testResult && (
          <p className={`text-xs mt-1.5 ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
            {testResult.ok ? `✓ Delivered (HTTP ${testResult.status_code})` : `✗ ${testResult.error || `HTTP ${testResult.status_code}`}`}
          </p>
        )}
      </div>
    </div>
  )
}
