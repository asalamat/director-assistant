import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import { Button, Spinner, EmptyState } from './ui'

interface TaskState {
  status: 'running' | 'done' | 'error'
  imported: number
  skipped: number
  processed: number
  current: string
  backend: string
  error: string | null
  filename: string
  size_mb: number
}

interface Availability {
  available: boolean
  olm_available: boolean
  pst_available: boolean
  pst_backend?: string
  olm_backend?: string
  pst_error?: string
}

function DropZone({ onFile, disabled, acceptOlm }: { onFile: (f: File) => void; disabled?: boolean; acceptOlm?: boolean }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isValid = (f: File) => f.name.toLowerCase().endsWith('.pst') || (acceptOlm && f.name.toLowerCase().endsWith('.olm'))
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && isValid(file)) onFile(file)
  }, [onFile, acceptOlm])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-4 border-2 border-dashed rounded-2xl p-10 cursor-pointer transition-all duration-150 ${
        disabled ? 'opacity-50 cursor-not-allowed' :
        dragging ? 'border-accent-400 bg-accent-50 scale-[1.01]' :
        'border-gray-200 hover:border-accent-300 hover:bg-gray-50'
      }`}
    >
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${dragging ? 'bg-accent-100' : 'bg-gray-100'}`}>
        <svg className={`w-7 h-7 ${dragging ? 'text-accent-500' : 'text-gray-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
        </svg>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-gray-700">Drop your PST file here</p>
        <p className="text-xs text-gray-400 mt-1">or click to browse · Outlook .pst and .olm files</p>
      </div>
      <Button variant="secondary" size="sm" disabled={disabled}>
        Choose file…
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pst,.olm"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }}
      />
    </div>
  )
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : 0
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function PSTImport() {
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [uploading, setUploading] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [task, setTask] = useState<TaskState | null>(null)
  const [pastTasks, setPastTasks] = useState<TaskState[]>([])
  const esRef = useRef<EventSource | null>(null)

  // Check availability on mount
  useEffect(() => {
    api.checkPSTAvailability().then(setAvailability).catch(() =>
      setAvailability({ available: true, olm_available: true, pst_available: false, pst_error: 'Could not connect to server' })
    )
    api.listPSTTasks().then(r => setPastTasks(r.tasks || [])).catch(() => {})
  }, [])

  // Stream progress once we have a taskId
  useEffect(() => {
    if (!taskId) return
    esRef.current?.close()
    const es = api.streamPSTProgress(taskId)
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const data: TaskState = JSON.parse(e.data)
        setTask(data)
        if (data.status === 'done' || data.status === 'error') {
          es.close()
          api.listPSTTasks().then(r => setPastTasks(r.tasks || [])).catch(() => {})
        }
      } catch { /* ignore */ }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [taskId])

  const handleFile = async (file: File) => {
    setUploading(true)
    setTask(null)
    setTaskId(null)
    try {
      const { task_id } = await api.importPST(file)
      setTaskId(task_id)
      setTask({
        status: 'running', imported: 0, skipped: 0, processed: 0,
        current: 'Starting…', backend: '', error: null,
        filename: file.name, size_mb: Math.round(file.size / 1_048_576 * 10) / 10,
      })
    } catch (err: any) {
      setTask({ status: 'error', imported: 0, skipped: 0, processed: 0, current: '',
                backend: '', error: err.message || 'Upload failed', filename: file.name, size_mb: 0 })
    } finally {
      setUploading(false)
    }
  }

  const reset = () => { setTask(null); setTaskId(null) }

  // ── Not available ────────────────────────────────────────────────────────
  if (availability === null) {
    return <div className="flex justify-center py-16"><Spinner size="md" /></div>
  }

  // OLM always works; only PST needs an external tool
  // availability.available is true if OLM works (always) or PST works

  // ── Main UI ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-gray-800">Import Email Archive</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Import emails from an Outlook archive into Director Assistant. All emails will be searchable and available for AI analysis.
        </p>
        {/* Format support badges */}
        <div className="flex gap-2 mt-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            ✓ OLM — Outlook for Mac
          </span>
          {availability?.pst_available ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              ✓ PST — Outlook for Windows ({availability.pst_backend})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
              title={availability?.pst_error || 'Run: brew install libpst'}>
              ⚠ PST — needs readpst (brew install libpst)
            </span>
          )}
        </div>
      </div>

      {/* Drop zone / active import */}
      {!task && (
        <DropZone onFile={handleFile} disabled={uploading} acceptOlm={true} />
      )}

      {uploading && !task && (
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <Spinner size="sm" />
          <span>Uploading file…</span>
        </div>
      )}

      {/* Active task */}
      {task && (
        <div className={`border rounded-2xl p-5 space-y-4 ${
          task.status === 'error' ? 'border-red-200 bg-red-50' :
          task.status === 'done'  ? 'border-emerald-200 bg-emerald-50' :
          'border-accent-200 bg-accent-50/50'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{task.filename}</p>
              <p className="text-xs text-gray-500 mt-0.5">{task.size_mb} MB · {task.backend || 'processing'}</p>
            </div>
            {task.status === 'running' && <Spinner size="sm" />}
            {task.status === 'done' && <span className="text-2xl">✅</span>}
            {task.status === 'error' && <span className="text-2xl">❌</span>}
          </div>

          {task.status === 'running' && (
            <>
              <ProgressBar value={task.imported} max={Math.max(task.imported + 100, 200)} />
              <p className="text-xs text-gray-500 truncate">
                {task.imported.toLocaleString()} emails imported
                {task.current && <span className="ml-1 text-gray-400">· {task.current}</span>}
              </p>
            </>
          )}

          {task.status === 'done' && (
            <div className="grid grid-cols-3 gap-3 pt-1">
              {[
                { label: 'Imported', value: task.imported.toLocaleString(), color: 'text-emerald-700' },
                { label: 'Skipped', value: task.skipped.toLocaleString(), color: 'text-gray-500' },
                { label: 'Total', value: (task.imported + task.skipped).toLocaleString(), color: 'text-gray-700' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center bg-white/80 rounded-xl py-2.5">
                  <p className={`text-lg font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
                </div>
              ))}
            </div>
          )}

          {task.status === 'error' && (
            <p className="text-sm text-red-700">{task.error}</p>
          )}

          {(task.status === 'done' || task.status === 'error') && (
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={reset}>Import another</Button>
            </div>
          )}
        </div>
      )}

      {/* Past imports */}
      {pastTasks.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Import history</p>
          <div className="space-y-2">
            {pastTasks.filter(t => t.filename !== task?.filename || t.status !== task?.status).slice(0, 5).map((t, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                <span>{t.status === 'done' ? '✅' : t.status === 'error' ? '❌' : '⏳'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{t.filename}</p>
                  <p className="text-[10px] text-gray-400">
                    {t.status === 'done' ? `${t.imported.toLocaleString()} emails imported` :
                     t.status === 'error' ? t.error :
                     'In progress…'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-xs text-gray-500 leading-relaxed space-y-1.5">
        <p className="font-semibold text-gray-600">Tips</p>
        <p>· Large PST files (1 GB+) may take 5–15 minutes to import</p>
        <p>· Imported emails are indexed immediately for AI search and analysis</p>
        <p>· Duplicate emails (same sender + subject + date) are skipped automatically</p>
        <p>· You can import multiple PST files — each adds to the existing email database</p>
      </div>
    </div>
  )
}
