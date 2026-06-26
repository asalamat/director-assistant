import { useEffect, useState, useRef } from 'react'
import { api } from '../api/client'

interface UpdateInfo {
  current: string
  latest: string
  update_available: boolean
}

export default function UpdatePopup() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [logText, setLogText] = useState('')
  const [logPath, setLogPath] = useState('')
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const check = () => {
      api.checkUpdate().then(res => {
        if (res.update_available && res.latest) {
          setUpdate({ current: res.current, latest: res.latest, update_available: true })
        }
      }).catch(() => {})
    }
    check()
    const interval = setInterval(check, 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Poll log while update is running
  useEffect(() => {
    if (!applying) return
    const poll = setInterval(() => {
      api.getUpdateLog().then(res => {
        if (res.log) {
          setLogText(res.log)
          setLogPath(res.path)
          // Auto-scroll log
          if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight
          }
        }
      }).catch(() => {})
    }, 2000)
    return () => clearInterval(poll)
  }, [applying])

  if (!update || dismissed) return null

  const handleUpdate = async () => {
    setApplying(true); setIsError(false); setShowLog(true)
    setMessage('Starting update…')
    setLogText('')
    try {
      const res = await api.applyUpdate()
      if (res.log_path) setLogPath(res.log_path)
      setMessage('Update running — reloading when ready…')
      await new Promise<void>(resolve => {
        const start = Date.now()
        const poll = setInterval(async () => {
          if (Date.now() - start < 15_000) return
          try {
            const r = await fetch('/health', { cache: 'no-store' })
            if (r.ok) { clearInterval(poll); resolve() }
          } catch { /* still restarting */ }
          if (Date.now() - start > 180_000) { clearInterval(poll); resolve() }
        }, 3_000)
      })
      window.location.reload()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Update failed'
      const isSetup = msg.includes('repo') || msg.includes('venv') || msg.includes('environment') || msg.includes('install')
      setIsError(true)
      setMessage(isSetup
        ? `${msg} — re-run install.bat (Windows) or install-mac.sh (Mac) to fix.`
        : `${msg} — see log below for details.`)
      setApplying(false)
    }
  }

  const fetchLog = async () => {
    const res = await api.getUpdateLog().catch(() => null)
    if (res?.log) { setLogText(res.log); setLogPath(res.path) }
    setShowLog(true)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-white border border-blue-200 rounded-xl shadow-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">Update available</p>
          <p className="text-xs text-gray-500 mt-0.5">
            v{update.current} → v{update.latest}
          </p>
          {message && (
            <p className={`text-xs mt-1 ${isError ? 'text-red-600' : 'text-blue-600'}`}>{message}</p>
          )}
        </div>
        {!applying && (
          <button
            onClick={() => setDismissed(true)}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Dismiss"
          >×</button>
        )}
      </div>

      {!applying ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleUpdate}
            className="flex-1 bg-blue-600 text-white text-xs font-medium py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {isError ? 'Retry' : 'Install Update'}
          </button>
          <button
            onClick={isError ? fetchLog : () => setDismissed(true)}
            className="flex-1 text-xs text-gray-500 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            {isError ? 'View Log' : 'Later'}
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="w-full bg-blue-100 rounded-full h-1.5">
            <div className="bg-blue-500 h-1.5 rounded-full animate-pulse w-3/4" />
          </div>
          <p className="text-xs text-gray-400 mt-1 text-center">{message || 'Reloading when server is ready…'}</p>
          <button
            onClick={() => setShowLog(v => !v)}
            className="mt-1 text-xs text-blue-500 hover:underline w-full text-center"
          >
            {showLog ? 'Hide log' : 'Show log'}
          </button>
        </div>
      )}

      {showLog && (
        <div className="mt-2">
          {logPath && <p className="text-xs text-gray-400 mb-1 truncate" title={logPath}>Log: {logPath}</p>}
          <pre
            ref={logRef}
            className="text-xs bg-gray-900 text-green-400 rounded p-2 h-32 overflow-y-auto whitespace-pre-wrap font-mono"
          >
            {logText || 'Waiting for log…'}
          </pre>
        </div>
      )}
    </div>
  )
}
