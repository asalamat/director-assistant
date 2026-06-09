import { useState, useEffect } from 'react'

export function TasksExportSettings() {
  const [notionKey, setNotionKey] = useState('')
  const [notionDb, setNotionDb] = useState('')
  const [jiraUrl, setJiraUrl] = useState('')
  const [jiraEmail, setJiraEmail] = useState('')
  const [jiraToken, setJiraToken] = useState('')
  const [jiraProject, setJiraProject] = useState('')
  const [todoistToken, setTodoistToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testStatus, setTestStatus] = useState<{notion: boolean; jira: boolean; todoist: boolean} | null>(null)

  useEffect(() => {
    fetch('/api/tasks/export/config').then(r => r.json()).then((cfg: any) => {
      setJiraUrl(cfg.jira_url || '')
      setJiraEmail(cfg.jira_email || '')
      setJiraProject(cfg.jira_project_key || '')
      setNotionDb(cfg.notion_database_id || '')
      // tokens never returned from server — user re-enters to update
    }).catch(() => {})
    fetch('/api/tasks/export/status').then(r => r.json()).then(setTestStatus).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    const payload: any = {
      jira_url: jiraUrl, jira_email: jiraEmail,
      jira_project_key: jiraProject, notion_database_id: notionDb,
    }
    if (notionKey) payload.notion_api_key = notionKey
    if (jiraToken) payload.jira_api_token = jiraToken
    if (todoistToken) payload.todoist_api_token = todoistToken
    await fetch('/api/tasks/export/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    fetch('/api/tasks/export/status').then(r => r.json()).then(setTestStatus).catch(() => {})
  }

  const Section = ({ title, icon, active, children }: any) => (
    <div className={`border rounded-xl p-4 space-y-3 ${active ? 'border-green-300 bg-green-50/30' : 'border-gray-200'}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <p className="text-sm font-semibold text-gray-800 flex-1">{title}</p>
        {active && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Connected</span>}
      </div>
      {children}
    </div>
  )

  return (
    <div className="space-y-4">
      <Section title="Notion" icon="📝" active={testStatus?.notion}>
        <input value={notionKey} onChange={e => setNotionKey(e.target.value)} type="password"
          placeholder="Notion API key (secret_…)" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
        <input value={notionDb} onChange={e => setNotionDb(e.target.value)}
          placeholder="Database ID (from Notion URL)" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
      </Section>

      <Section title="Jira" icon="🔵" active={testStatus?.jira}>
        <input value={jiraUrl} onChange={e => setJiraUrl(e.target.value)}
          placeholder="https://yourorg.atlassian.net" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
        <input value={jiraEmail} onChange={e => setJiraEmail(e.target.value)}
          placeholder="your@email.com" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
        <input value={jiraToken} onChange={e => setJiraToken(e.target.value)} type="password"
          placeholder="API token" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
        <input value={jiraProject} onChange={e => setJiraProject(e.target.value)}
          placeholder="Project key (e.g. ENG)" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
      </Section>

      <Section title="Todoist" icon="🔴" active={testStatus?.todoist}>
        <input value={todoistToken} onChange={e => setTodoistToken(e.target.value)} type="password"
          placeholder="API token" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
      </Section>

      <button onClick={save} disabled={saving}
        className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Integrations'}
      </button>
    </div>
  )
}
