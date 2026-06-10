import { useState } from 'react'
import { api } from '../../api/client'

interface Props { onClose: () => void }

export function MeetingPrepModal({ onClose }: Props) {
  const [subject, setSubject] = useState('')
  const [attendees, setAttendees] = useState('')
  const [date, setDate] = useState('')
  const [brief, setBrief] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    if (!subject.trim()) return
    setLoading(true); setError(''); setBrief('')
    try {
      const r = await api.getMeetingPrep({
        subject,
        attendees: attendees.split(',').map(a => a.trim()).filter(Boolean),
        meeting_date: date,
      })
      setBrief(r.brief)
    } catch (e: any) { setError(e.message || 'Failed') }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden m-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Meeting Prep</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&#x2715;</button>
        </div>
        <div className="p-6 space-y-3 flex-shrink-0">
          <input value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Meeting subject or topic&hellip;"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"/>
          <input value={attendees} onChange={e => setAttendees(e.target.value)}
            placeholder="Attendee emails, comma-separated (optional)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"/>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"/>
          <button onClick={generate} disabled={loading || !subject.trim()}
            className="w-full bg-accent text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
            {loading ? 'Generating brief…' : '✨ Generate Meeting Brief'}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        {brief && (
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <pre className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed font-sans">{brief}</pre>
            <button onClick={() => navigator.clipboard.writeText(brief).catch(()=>{})}
              className="mt-3 text-xs text-gray-400 hover:text-accent border border-gray-200 rounded px-2 py-1">Copy</button>
          </div>
        )}
      </div>
    </div>
  )
}
