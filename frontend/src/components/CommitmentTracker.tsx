import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { Commitment } from '../types'

function isOverdue(due: string | null): boolean {
  if (!due) return false
  const d = new Date(due.includes('T') || due.includes('Z') ? due : due + 'T23:59:59')
  return !isNaN(d.getTime()) && d.getTime() < Date.now()
}

function formatDue(due: string | null): string {
  if (!due) return ''
  const d = new Date(due.includes('T') || due.includes('Z') ? due : due + 'T00:00:00')
  if (isNaN(d.getTime())) return due
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function CommitmentCard({ item, onDone }: { item: Commitment; onDone: (id: number) => void }) {
  const overdue = isOverdue(item.due_date)
  return (
    <div className="border border-gray-200 rounded-lg bg-white p-3 space-y-1.5">
      <p className="text-sm text-gray-800 leading-snug">{item.description}</p>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {item.counterparty && (
            <span className="text-xs text-gray-500 truncate">{item.counterparty}</span>
          )}
          {item.due_date && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${overdue ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
              {overdue ? 'overdue ' : 'due '}{formatDue(item.due_date)}
            </span>
          )}
        </div>
        <button
          onClick={() => onDone(item.id)}
          className="flex-shrink-0 text-xs px-2.5 py-1 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors"
        >
          Done ✓
        </button>
      </div>
    </div>
  )
}

export function CommitmentTracker() {
  const [iOwe, setIOwe] = useState<Commitment[]>([])
  const [theyOwe, setTheyOwe] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { commitments } = await api.getCommitments({ status: 'open' })
      setIOwe(commitments.filter(c => c.direction === 'i_owe'))
      setTheyOwe(commitments.filter(c => c.direction === 'they_owe'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load commitments.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const scan = async () => {
    if (scanning) return
    setScanning(true)
    setError('')
    try {
      await api.scanCommitmentsBulk(7)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed.')
    } finally {
      setScanning(false)
    }
  }

  const markDone = async (id: number) => {
    setIOwe(prev => prev.filter(c => c.id !== id))
    setTheyOwe(prev => prev.filter(c => c.id !== id))
    try {
      await api.fulfillCommitment(id, 'fulfilled')
    } catch {
      load()
    }
  }

  const empty = !loading && iOwe.length === 0 && theyOwe.length === 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Promises tracked from your email threads.</p>
        <button
          onClick={scan}
          disabled={scanning}
          className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
        >
          {scanning
            ? <><span className="animate-spin inline-block">⟳</span> Scanning…</>
            : 'Scan Recent'}
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {empty ? (
        <p className="text-xs text-gray-500 italic py-2">No open commitments found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              You Owe <span className="text-gray-300">({iOwe.length})</span>
            </p>
            {iOwe.length === 0
              ? <p className="text-xs text-gray-400 italic">Nothing on your plate.</p>
              : iOwe.map(c => <CommitmentCard key={c.id} item={c} onDone={markDone} />)}
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              They Owe <span className="text-gray-300">({theyOwe.length})</span>
            </p>
            {theyOwe.length === 0
              ? <p className="text-xs text-gray-400 italic">Nothing outstanding.</p>
              : theyOwe.map(c => <CommitmentCard key={c.id} item={c} onDone={markDone} />)}
          </div>
        </div>
      )}
    </div>
  )
}
