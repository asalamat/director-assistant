import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import { Spinner } from './ui'

interface Task {
  id: number
  phase_name: string
  name: string
  assignee: string
  duration_days: number
  priority: string
  status: string
  depends_on: string[]
  comment_count: number
}

interface TaskComment {
  id: number
  comment: string
  created_at: string
  suggestions?: string[]
}

interface TaskCardProps {
  task: Task
  onUpdate: (taskId: number, data: Partial<Task>) => Promise<void>
  onDelete: (taskId: number) => Promise<void>
  projectId: number
}

const PRIORITY_DOT: Record<string, string> = {
  high:   'bg-red-400',
  medium: 'bg-amber-400',
  low:    'bg-gray-300',
}

const STATUS_ORDER = ['not_started', 'in_progress', 'done', 'blocked'] as const
type TaskStatus = typeof STATUS_ORDER[number]

const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  done: 'Done',
  blocked: 'Blocked',
}

function TaskCard({ task, onUpdate, onDelete, projectId }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [assignee, setAssignee] = useState(task.assignee)
  const [priority, setPriority] = useState(task.priority)
  const [dependsOn, setDependsOn] = useState(task.depends_on.join(', '))
  const [saving, setSaving] = useState(false)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [addingComment, setAddingComment] = useState(false)
  const [latestSuggestions, setLatestSuggestions] = useState<string[]>([])

  const loadComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const r = await api.getTaskComments(projectId, task.id)
      setComments(r.comments)
    } catch { /* ignore */ }
    setCommentsLoading(false)
  }, [projectId, task.id])

  useEffect(() => {
    if (expanded) loadComments()
  }, [expanded, loadComments])

  const save = async () => {
    setSaving(true)
    await onUpdate(task.id, {
      assignee,
      priority,
      depends_on: dependsOn.split(',').map(s => s.trim()).filter(Boolean),
    })
    setSaving(false)
  }

  const moveStatus = async (dir: 'next' | 'prev') => {
    const idx = STATUS_ORDER.indexOf(task.status as TaskStatus)
    const next = dir === 'next' ? STATUS_ORDER[idx + 1] : STATUS_ORDER[idx - 1]
    if (!next) return
    await onUpdate(task.id, { status: next })
  }

  const submitComment = async () => {
    if (!newComment.trim()) return
    setAddingComment(true)
    try {
      const r = await api.addTaskComment(projectId, task.id, newComment.trim())
      setComments(prev => [...prev, { id: r.id, comment: r.comment, created_at: new Date().toISOString() }])
      if (r.suggestions?.length) setLatestSuggestions(r.suggestions)
      setNewComment('')
    } catch { /* ignore */ }
    setAddingComment(false)
  }

  const statusIdx = STATUS_ORDER.indexOf(task.status as TaskStatus)

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md transition-shadow">
      <div className="px-3 py-2.5 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <div className="flex items-start gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${PRIORITY_DOT[task.priority.toLowerCase()] ?? PRIORITY_DOT.low}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-800 leading-snug">{task.name}</p>
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">{task.phase_name} · {task.assignee || 'Unassigned'}</p>
          </div>
          {task.comment_count > 0 && (
            <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full flex-shrink-0">
              {task.comment_count}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-50 px-3 py-3 space-y-3">
          {/* Edit fields */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-0.5">Assignee</label>
              <input value={assignee} onChange={e => setAssignee(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-0.5">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-0.5">Depends on (comma-separated)</label>
            <input value={dependsOn} onChange={e => setDependsOn(e.target.value)}
              placeholder="e.g. Design mockups, API spec"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving}
              className="text-xs bg-blue-500 text-white px-2.5 py-1 rounded-lg hover:bg-blue-600 disabled:opacity-50">
              {saving ? '…' : 'Save'}
            </button>
            <div className="flex gap-1 ml-auto">
              <button onClick={() => moveStatus('prev')} disabled={statusIdx <= 0}
                className="text-[10px] border border-gray-200 px-2 py-0.5 rounded hover:bg-gray-50 disabled:opacity-30">← Prev</button>
              <button onClick={() => moveStatus('next')} disabled={statusIdx >= STATUS_ORDER.length - 1}
                className="text-[10px] border border-gray-200 px-2 py-0.5 rounded hover:bg-gray-50 disabled:opacity-30">Next →</button>
            </div>
            <button onClick={() => onDelete(task.id)}
              className="text-[10px] text-red-400 hover:text-red-600 px-1 py-0.5 ml-1">Delete</button>
          </div>

          {/* AI suggestions */}
          {latestSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {latestSuggestions.map((s, i) => (
                <span key={i} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          )}

          {/* Comments */}
          <div className="pt-1 border-t border-gray-50">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Comments</p>
            {commentsLoading && <Spinner size="sm" />}
            {!commentsLoading && comments.length === 0 && (
              <p className="text-[10px] text-gray-300 italic">No comments yet</p>
            )}
            <div className="space-y-1.5 max-h-32 overflow-y-auto mb-2">
              {comments.map(c => (
                <div key={c.id} className="text-[11px] bg-gray-50 rounded-lg px-2.5 py-1.5">
                  <p className="text-gray-700 leading-relaxed">{c.comment}</p>
                  <p className="text-[9px] text-gray-300 mt-0.5">{c.created_at.slice(0, 16).replace('T', ' ')}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)}
                rows={2} placeholder="Add a comment…"
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400" />
              <button onClick={submitComment} disabled={addingComment || !newComment.trim()}
                className="text-xs bg-teal-500 text-white px-2.5 rounded-lg hover:bg-teal-600 disabled:opacity-40 self-end pb-1 pt-1">
                {addingComment ? '…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const COLUMN_CONFIG: { status: TaskStatus; label: string; headerCls: string }[] = [
  { status: 'not_started', label: 'Not Started', headerCls: 'bg-gray-100 text-gray-600' },
  { status: 'in_progress', label: 'In Progress', headerCls: 'bg-blue-100 text-blue-700' },
  { status: 'done',        label: 'Done',        headerCls: 'bg-green-100 text-green-700' },
  { status: 'blocked',     label: 'Blocked',     headerCls: 'bg-red-100 text-red-600' },
]

interface Props { projectId: number }

export function ProjectTaskBoard({ projectId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [planMsg, setPlanMsg] = useState('')
  const [addingIn, setAddingIn] = useState<TaskStatus | null>(null)
  const [newTaskName, setNewTaskName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getProjectTasks(projectId)
      setTasks(r.tasks)
    } catch { setTasks([]) }
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  const handleUpdate = async (taskId: number, data: Partial<Task>) => {
    await api.updateProjectTask(projectId, taskId, data)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...data } : t))
  }

  const handleDelete = async (taskId: number) => {
    if (!confirm('Delete this task?')) return
    await api.deleteProjectTask(projectId, taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }

  const addTask = async (status: TaskStatus) => {
    if (!newTaskName.trim()) return
    const r = await api.createProjectTask(projectId, { name: newTaskName.trim(), status, assignee: '', priority: 'medium', phase_name: '', duration_days: 1, depends_on: [] })
    const newTask: Task = { id: r.id, name: newTaskName.trim(), status, assignee: '', priority: 'medium', phase_name: '', duration_days: 1, depends_on: [], comment_count: 0 }
    setTasks(prev => [...prev, newTask])
    setNewTaskName('')
    setAddingIn(null)
  }

  const loadFromPlan = async () => {
    setLoadingPlan(true)
    setPlanMsg('')
    try {
      const r = await api.loadTasksFromPlan(projectId)
      setPlanMsg(`Loaded ${r.inserted} task${r.inserted !== 1 ? 's' : ''} from plan`)
      await load()
    } catch (err: any) {
      setPlanMsg(err?.message || 'Failed to load from plan')
    }
    setLoadingPlan(false)
  }

  return (
    <div className="pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-700">Task Board</p>
        <div className="flex items-center gap-2">
          {planMsg && <span className="text-[10px] text-teal-600">{planMsg}</span>}
          <button onClick={loadFromPlan} disabled={loadingPlan}
            className="text-xs border border-gray-200 px-2.5 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1">
            {loadingPlan ? <Spinner size="sm" /> : null}
            {loadingPlan ? 'Loading…' : '⚡ Load from Plan'}
          </button>
        </div>
      </div>

      {loading && <div className="flex justify-center py-6"><Spinner size="md" /></div>}

      {!loading && (
        <div className="grid grid-cols-4 gap-3 min-h-[160px]">
          {COLUMN_CONFIG.map(({ status, label, headerCls }) => {
            const col = tasks.filter(t => t.status === status)
            return (
              <div key={status} className="flex flex-col gap-2">
                <div className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg flex items-center justify-between ${headerCls}`}>
                  <span>{label}</span>
                  <span className="opacity-70">{col.length}</span>
                </div>
                <div className="flex-1 space-y-2">
                  {col.map(task => (
                    <TaskCard key={task.id} task={task} projectId={projectId} onUpdate={handleUpdate} onDelete={handleDelete} />
                  ))}
                </div>
                {addingIn === status ? (
                  <div className="flex gap-1.5 mt-1">
                    <input autoFocus value={newTaskName} onChange={e => setNewTaskName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addTask(status); if (e.key === 'Escape') { setAddingIn(null); setNewTaskName('') } }}
                      placeholder="Task name…"
                      className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    <button onClick={() => addTask(status)}
                      className="text-xs bg-blue-500 text-white px-2 rounded-lg hover:bg-blue-600">+</button>
                    <button onClick={() => { setAddingIn(null); setNewTaskName('') }}
                      className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setAddingIn(status); setNewTaskName('') }}
                    className="text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg px-2 py-1 border border-dashed border-gray-200 text-left transition-colors">
                    + Add Task
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
