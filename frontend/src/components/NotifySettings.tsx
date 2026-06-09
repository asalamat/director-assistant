import { useState, useEffect } from 'react'
import { api } from '../api/client'

export function NotifySettings() {
  const [slackUrl, setSlackUrl] = useState('')
  const [teamsUrl, setTeamsUrl] = useState('')
  const [slackVip, setSlackVip] = useState(false)
  const [slackUrgent, setSlackUrgent] = useState(false)
  const [teamsVip, setTeamsVip] = useState(false)
  const [teamsUrgent, setTeamsUrgent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [slackTest, setSlackTest] = useState<{ok: boolean; error?: string} | null>(null)
  const [teamsTest, setTeamsTest] = useState<{ok: boolean; error?: string} | null>(null)
  const [testingSlack, setTestingSlack] = useState(false)
  const [testingTeams, setTestingTeams] = useState(false)

  useEffect(() => {
    api.getConfig().then((cfg: any) => {
      setSlackUrl(cfg.slack_webhook_url || '')
      setTeamsUrl(cfg.teams_webhook_url || '')
      setSlackVip(!!cfg.slack_vip_notify)
      setSlackUrgent(!!cfg.slack_auto_urgent)
      setTeamsVip(!!cfg.teams_vip_notify)
      setTeamsUrgent(!!cfg.teams_auto_urgent)
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    await api.saveConfig({
      slack_webhook_url: slackUrl, teams_webhook_url: teamsUrl,
      slack_vip_notify: slackVip, slack_auto_urgent: slackUrgent,
      teams_vip_notify: teamsVip, teams_auto_urgent: teamsUrgent,
    } as any).catch(() => {})
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const testSlack = async () => {
    setTestingSlack(true); setSlackTest(null)
    const r = await fetch('/api/notify/test-slack', { method: 'POST' }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }))
    setSlackTest(r); setTestingSlack(false)
  }

  const testTeams = async () => {
    setTestingTeams(true); setTeamsTest(null)
    const r = await fetch('/api/notify/test-teams', { method: 'POST' }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }))
    setTeamsTest(r); setTestingTeams(false)
  }

  return (
    <div className="space-y-5">
      {/* Slack */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">💬</span>
          <p className="text-sm font-semibold text-gray-800">Slack</p>
        </div>
        <input value={slackUrl} onChange={e => setSlackUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/…"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={slackVip} onChange={e => setSlackVip(e.target.checked)} className="accent-accent"/>
            Auto-post when a VIP contact emails you
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={slackUrgent} onChange={e => setSlackUrgent(e.target.checked)} className="accent-accent"/>
            Auto-post urgent / action-required emails
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={testSlack} disabled={testingSlack || !slackUrl.trim()}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            {testingSlack ? '…' : 'Send test message'}
          </button>
          {slackTest && <span className={`text-xs ${slackTest.ok ? 'text-green-600' : 'text-red-500'}`}>{slackTest.ok ? '✓ Connected' : `✗ ${slackTest.error}`}</span>}
        </div>
      </div>

      {/* Teams */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🟦</span>
          <p className="text-sm font-semibold text-gray-800">Microsoft Teams</p>
        </div>
        <input value={teamsUrl} onChange={e => setTeamsUrl(e.target.value)}
          placeholder="https://outlook.office.com/webhook/…"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={teamsVip} onChange={e => setTeamsVip(e.target.checked)} className="accent-accent"/>
            Auto-post when a VIP contact emails you
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={teamsUrgent} onChange={e => setTeamsUrgent(e.target.checked)} className="accent-accent"/>
            Auto-post urgent / action-required emails
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={testTeams} disabled={testingTeams || !teamsUrl.trim()}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 transition-colors">
            {testingTeams ? '…' : 'Send test message'}
          </button>
          {teamsTest && <span className={`text-xs ${teamsTest.ok ? 'text-green-600' : 'text-red-500'}`}>{teamsTest.ok ? '✓ Connected' : `✗ ${teamsTest.error}`}</span>}
        </div>
      </div>

      <button onClick={save} disabled={saving}
        className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  )
}
