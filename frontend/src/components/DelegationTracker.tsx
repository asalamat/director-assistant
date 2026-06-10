import { useState, useEffect } from 'react'
import { api } from '../api/client'

export function DelegationTracker() {
  const [delegations, setDelegations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => {
    setLoading(true)
    api.getDelegations(filter === 'pending' ? 'pending' : undefined)
      .then(r => setDelegations(r.delegations))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [filter])

  const autoCheck = async () => {
    setChecking(true)
    try {
      const r = await api.autoCheckDelegations()
      setMsg(`✓ Auto-resolved ${r.resolved} delegation${r.resolved !== 1 ? 's' : ''}`)
      load()
    } catch {}
    setChecking(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const resolve = async (id: number) => {
    await api.resolveDelegation(id)
    setDelegations(prev => prev.filter(d => d.id !== id || filter !== 'pending'))
    load()
  }

  const del = async (id: number) => {
    await api.deleteDelegation(id)
    setDelegations(prev => prev.filter(d => d.id !== id))
  }

  const pending = delegations.filter(d => d.status === 'pending')

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-gray-800">Delegations</h2>
          <p className="text-xs text-gray-400">{pending.length} pending — forwarded emails awaiting action</p>
        </div>
        <button onClick={() => setFilter(f => f === 'pending' ? 'all' : 'pending')}
          className="text-xs text-gray-400 hover:text-accent border border-gray-200 rounded-lg px-2 py-1 transition-colors">
          {filter === 'pending' ? 'Show all' : 'Pending only'}
        </button>
        <button onClick={autoCheck} disabled={checking}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {checking ? '…' : '🔄 Auto-check'}
        </button>
      </div>
      {msg && <p className="px-4 text-xs text-green-600 flex-shrink-0">{msg}</p>}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>}
        {!loading && delegations.length === 0 && (
          <div className="text-center py-12">
            <p className="text-2xl mb-2">✓</p>
            <p className="text-sm text-gray-500">No pending delegations</p>
            <p className="text-xs text-gray-400 mt-1">When you forward emails to delegate, they'll appear here.</p>
          </div>
        )}
        {delegations.map(d => (
          <div key={d.id} className={`border rounded-xl p-3 space-y-1.5 ${d.status === 'resolved' ? 'border-gray-100 opacity-60' : 'border-orange-200 bg-orange-50/30'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{d.subject || '(no subject)'}</p>
                <p className="text-xs text-gray-500">Delegated to: <span className="font-medium">{d.delegated_to}</span></p>
                <p className="text-xs text-gray-400">{d.delegated_at?.slice(0, 10)} · from {d.original_sender}</p>
                {d.note && <p className="text-xs text-gray-500 mt-0.5 italic">{d.note}</p>}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {d.status === 'pending' && (
                  <button onClick={() => resolve(d.id)}
                    className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded hover:bg-green-200 transition-colors">
                    ✓ Resolved
                  </button>
                )}
                <button onClick={() => del(d.id)}
                  className="text-xs text-gray-300 hover:text-red-400 px-1 transition-colors">✕</button>
              </div>
            </div>
            {d.status === 'resolved' && <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">Resolved {d.resolved_at?.slice(0,10)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
