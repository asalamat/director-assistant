import { useState, useEffect } from 'react'
import { api } from '../api/client'

export function BackupSettings() {
  const [stats, setStats] = useState<{ db_size_mb: number; last_modified: number | null } | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.getBackupStats().then(setStats).catch(() => {})
  }, [])

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setRestoring(true)
    setMsg('')
    try {
      const r = await api.importBackup(file)
      setMsg(`✓ ${r.message}`)
    } catch (err: unknown) {
      setMsg(`✗ ${err instanceof Error ? err.message : 'Restore failed'}`)
    }
    setRestoring(false)
  }

  const lastMod = stats?.last_modified
    ? new Date(stats.last_modified * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">&#128190;</span>
          <div>
            <p className="text-sm font-semibold text-gray-800">Database Backup</p>
            {stats && <p className="text-xs text-gray-400 mt-0.5">{stats.db_size_mb} MB{lastMod ? ` · modified ${lastMod}` : ''}</p>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href={api.exportBackupUrl()}
            download="director-assistant-backup.zip"
            className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Download backup
          </a>
          <label className={`text-xs border border-gray-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-gray-50 transition-colors ${restoring ? 'opacity-50 pointer-events-none' : ''}`}>
            {restoring ? 'Restoring…' : 'Restore from backup'}
            <input type="file" accept=".zip" className="hidden" onChange={handleRestore} disabled={restoring} />
          </label>
        </div>
        {msg && (
          <p className={`text-xs ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>
        )}
        <p className="text-[10px] text-gray-400">
          Backup includes all emails, contacts, settings, and AI labels. Restoring replaces the current database &mdash; the app will need a restart.
        </p>
      </div>
    </div>
  )
}
