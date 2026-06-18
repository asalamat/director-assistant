import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { Spinner, EmptyState } from './ui'

interface TimelineEmail {
  id: string
  subject: string
  date: string
  direction: 'received' | 'sent'
  snippet: string
  folder: string
}

export function ContactTimeline({ emailAddr }: { emailAddr: string }) {
  const [emails, setEmails] = useState<TimelineEmail[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.getContactTimeline(emailAddr)
      .then((r) => { setEmails(r.emails); setTotal(r.total) })
      .catch(() => setError('Failed to load timeline'))
      .finally(() => setLoading(false))
  }, [emailAddr])

  if (loading) return <div className="flex justify-center py-6"><Spinner size="sm" /></div>
  if (error) return <p className="text-xs text-red-400 text-center py-4">{error}</p>
  if (emails.length === 0) return (
    <div className="py-4">
      <EmptyState icon="📭" title="No emails found" description="No history with this contact yet." />
    </div>
  )

  return (
    <div className="space-y-0 max-h-64 overflow-y-auto pr-1">
      {total > emails.length && (
        <p className="text-[10px] text-gray-400 text-right pb-1">Showing {emails.length} of {total}</p>
      )}
      {emails.map((em, i) => (
        <div key={em.id} className="relative pl-5">
          {/* vertical line */}
          {i < emails.length - 1 && (
            <div className="absolute left-1.5 top-4 bottom-0 w-px bg-gray-100" />
          )}
          {/* dot */}
          <div className={`absolute left-0 top-2.5 w-3 h-3 rounded-full border-2 ${
            em.direction === 'sent'
              ? 'border-gray-400 bg-white'
              : 'border-accent bg-accent'
          }`} />
          <div className="pb-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                em.direction === 'sent'
                  ? 'bg-gray-100 text-gray-500'
                  : 'bg-blue-50 text-blue-600'
              }`}>
                {em.direction === 'sent' ? '↑ Sent' : '↓ Received'}
              </span>
              <span className="text-[10px] text-gray-400">{em.date.slice(0, 10)}</span>
            </div>
            <p className="text-xs font-medium text-gray-800 truncate leading-tight">{em.subject || '(no subject)'}</p>
            {em.snippet && (
              <p className="text-[10px] text-gray-400 truncate mt-0.5 leading-tight">{em.snippet}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
