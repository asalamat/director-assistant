import { useState, useEffect } from 'react'
import type { EmailBrief } from '../types'
import { api } from '../api/client'
import { useUIContext } from '../contexts/UIContext'

interface OpenLoop {
  subject: string
  sender: string
  due_date?: string
  email_id: string
}

interface MorningPlan {
  priority_emails: EmailBrief[]
  open_loops: OpenLoop[]
  quick_win: string
  generated_at: string
}

export function MorningPlanPanel() {
  const { setActiveTab, setAskContext } = useUIContext()
  const [plan, setPlan] = useState<MorningPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.getMorningPlan()
      setPlan(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load morning plan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleOpenEmail = (email: EmailBrief) => {
    setAskContext(`Tell me about this email. Subject: "${email.subject}". From: ${email.sender}.`)
    setActiveTab('ask')
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-gray-500">
        <p>{error}</p>
        <button onClick={load} className="text-xs text-accent hover:underline">Retry</button>
      </div>
    )
  }

  if (!plan) return null

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Morning Plan</h2>
          {plan.generated_at && (
            <p className="text-xs text-gray-400 mt-0.5">
              Generated {new Date(plan.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <button
          onClick={load}
          className="text-xs text-accent hover:underline flex items-center gap-1"
        >
          ↺ Refresh
        </button>
      </div>

      {plan.quick_win && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-700 mb-1">Quick Win</p>
          <p className="text-sm text-amber-900">{plan.quick_win}</p>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Priority Emails ({plan.priority_emails.length})
          </p>
        </div>
        {plan.priority_emails.length === 0 ? (
          <p className="px-4 py-3 text-xs text-gray-400">No priority emails right now.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {plan.priority_emails.map((email, i) => (
              <li key={i}>
                <button
                  onClick={() => handleOpenEmail(email)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{email.subject || '(no subject)'}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{email.sender}</p>
                  {email.preview && (
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{email.preview}</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Open Loops ({plan.open_loops.length})
          </p>
        </div>
        {plan.open_loops.length === 0 ? (
          <p className="px-4 py-3 text-xs text-gray-400">No open loops. Nice work!</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {plan.open_loops.map((loop, i) => (
              <li key={i} className="px-4 py-3">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{loop.subject}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-gray-500 truncate">{loop.sender}</p>
                  {loop.due_date && (
                    <span className="text-xs font-medium text-red-500 flex-shrink-0">Due {loop.due_date}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
