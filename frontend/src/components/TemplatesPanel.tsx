import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { Template } from '../types'

interface Props {
  onInsert?: (text: string) => void
  email?: { sender?: string; subject?: string } | null
}

function applyMergeFields(template: string, email?: { sender?: string; subject?: string } | null): string {
  if (!email) return template
  const senderName = (email.sender || '').replace(/<[^>]+>/, '').trim().split(' ')[0] || 'there'
  const senderEmail = (email.sender || '').match(/<([^>]+)>/)?.[1] || email.sender || ''
  const company = senderEmail.split('@')[1]?.split('.')[0] || ''
  return template
    .replace(/\{\{name\}\}/gi, senderName)
    .replace(/\{\{email\}\}/gi, senderEmail)
    .replace(/\{\{company\}\}/gi, company)
    .replace(/\{\{subject\}\}/gi, email.subject || '')
    .replace(/\{\{date\}\}/gi, new Date().toLocaleDateString())
}

export function TemplatesPanel({ onInsert, email }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [editing, setEditing] = useState<Template | null>(null)
  const [draft, setDraft] = useState<Template>({ name: '', body: '' })
  const [formOpen, setFormOpen] = useState(false)

  const reload = async () => setTemplates(await api.getTemplates())

  useEffect(() => { reload() }, [])

  const save = async () => {
    if (!draft.name.trim() || !draft.body.trim()) return
    if (editing?.id) {
      await api.updateTemplate(editing.id, { ...draft, id: editing.id })
    } else {
      await api.createTemplate(draft)
    }
    setEditing(null)
    setDraft({ name: '', body: '' })
    setFormOpen(false)
    reload()
  }

  const startEdit = (t: Template) => {
    setEditing(t)
    setDraft({ name: t.name, body: t.body })
    setFormOpen(true)
  }

  const del = async (id: number) => {
    await api.deleteTemplate(id)
    reload()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-800">Reply Templates</h2>
        <button
          onClick={() => { setEditing(null); setDraft({ name: '', body: '' }); setFormOpen(true) }}
          className="text-xs bg-accent text-white px-2.5 py-1 rounded hover:bg-blue-700"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Editor */}
        {formOpen && (
          <div className="border border-accent rounded-xl p-3 space-y-2 bg-blue-50">
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Template name…"
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              placeholder="Template body… Use {{name}}, {{email}}, {{company}}, {{subject}}, {{date}} as merge fields"
              rows={5}
              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-[10px] text-gray-400">
              Merge fields: <span className="font-mono">{'{{name}}'}</span> <span className="font-mono">{'{{email}}'}</span> <span className="font-mono">{'{{company}}'}</span> <span className="font-mono">{'{{subject}}'}</span> <span className="font-mono">{'{{date}}'}</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={save}
                className="text-xs bg-accent text-white px-3 py-1.5 rounded hover:bg-blue-700"
              >
                {editing?.id ? 'Update' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(null); setDraft({ name: '', body: '' }); setFormOpen(false) }}
                className="text-xs border border-gray-300 text-gray-600 px-3 py-1.5 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Template list */}
        {templates.length === 0 && !formOpen && (
          <p className="text-sm text-gray-400 text-center py-12">
            No templates yet. Create one to save reusable replies.
          </p>
        )}
        {templates.map((t) => (
          <div key={t.id} className="border border-gray-200 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-800">{t.name}</p>
              <div className="flex gap-1.5">
                {onInsert && (
                  <button
                    onClick={() => onInsert(applyMergeFields(t.body, email))}
                    className="text-xs text-accent hover:underline"
                  >
                    Use
                  </button>
                )}
                <button onClick={() => startEdit(t)} className="text-xs text-gray-400 hover:text-gray-700">
                  Edit
                </button>
                <button onClick={() => del(t.id!)} className="text-xs text-gray-300 hover:text-red-400">
                  ✕
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-3">{t.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
