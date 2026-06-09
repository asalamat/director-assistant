import { useState, useEffect } from 'react'

interface Props {
  actionId: number
  text: string
  emailSubject?: string
}

interface ExportStatus { notion: boolean; jira: boolean; todoist: boolean }

export function TaskExportButton({ actionId, text, emailSubject }: Props) {
  const [status, setStatus] = useState<ExportStatus>({ notion: false, jira: false, todoist: false })
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<'notion' | 'jira' | 'todoist' | null>(null)
  const [title, setTitle] = useState(text)
  const [notes, setNotes] = useState(emailSubject || '')
  const [dueString, setDueString] = useState('')
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<{ok: boolean; msg: string} | null>(null)

  useEffect(() => {
    fetch('/api/tasks/export/status').then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  const hasAny = status.notion || status.jira || status.todoist
  if (!hasAny) return null

  const doExport = async () => {
    if (!modal) return
    setExporting(true)
    setResult(null)
    try {
      let body: any
      if (modal === 'notion') body = { action_id: actionId, title, notes }
      else if (modal === 'jira') body = { action_id: actionId, summary: title, description: notes }
      else body = { action_id: actionId, content: title, due_string: dueString }

      const r = await fetch(`/api/tasks/export/${modal}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json())
      setResult({ ok: r.ok, msg: r.ok ? `✓ Added to ${modal}` : (r.detail || 'Export failed') })
      if (r.ok) setTimeout(() => { setModal(null); setResult(null) }, 1500)
    } catch (e: any) {
      setResult({ ok: false, msg: e.message })
    }
    setExporting(false)
  }

  return (
    <>
      <div className="relative inline-block">
        <button onClick={() => setOpen(v => !v)} title="Export to task manager"
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-50 hover:border-accent transition-colors">
          📤 Export
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden min-w-[150px]"
            onMouseLeave={() => setOpen(false)}>
            {status.notion && (
              <button onClick={() => { setOpen(false); setTitle(text); setNotes(emailSubject||''); setModal('notion') }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 w-full text-left">
                📝 Notion
              </button>
            )}
            {status.jira && (
              <button onClick={() => { setOpen(false); setTitle(text); setNotes(emailSubject||''); setModal('jira') }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 w-full text-left">
                🔵 Jira
              </button>
            )}
            {status.todoist && (
              <button onClick={() => { setOpen(false); setTitle(text); setDueString(''); setModal('todoist') }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 w-full text-left">
                🔴 Todoist
              </button>
            )}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => { setModal(null); setResult(null) }}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-96 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-800 capitalize">Export to {modal}</h3>
            <div>
              <label className="text-xs text-gray-500">{modal === 'todoist' ? 'Task' : modal === 'jira' ? 'Summary' : 'Title'}</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
            </div>
            {modal !== 'todoist' && (
              <div>
                <label className="text-xs text-gray-500">{modal === 'jira' ? 'Description' : 'Notes'}</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-accent resize-none"/>
              </div>
            )}
            {modal === 'todoist' && (
              <div>
                <label className="text-xs text-gray-500">Due (optional)</label>
                <input value={dueString} onChange={e => setDueString(e.target.value)}
                  placeholder="e.g. next Monday, tomorrow"
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-accent"/>
              </div>
            )}
            {result && <p className={`text-xs ${result.ok ? 'text-green-600' : 'text-red-500'}`}>{result.msg}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setModal(null); setResult(null) }} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
              <button onClick={doExport} disabled={exporting || !title.trim()}
                className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {exporting ? 'Exporting…' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
