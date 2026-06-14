import { useState, useEffect } from 'react'
import type { EmailMessage } from '../../types'
import { ContactCard } from '../ContactCard'
import { Button } from '../ui'
import { api } from '../../api/client'
import { EmailNotifyButton } from '../EmailNotifyButton'

export interface EmailHeaderProps {
  email: EmailMessage
  analyzing: boolean
  onAnalyze: () => void
  onDelete: (id: string) => void
  onSnooze?: (id: string, date: string) => void
  onAsk?: () => void
  onSearch?: (q: string) => void
  onReplyClick: () => void
  onForwardClick: () => void
  onTranslate: () => void
  translating: boolean
  onArchive?: () => void
}

function formatDateFull(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString([], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function EmailHeader({
  email, analyzing, onAnalyze, onDelete, onSnooze, onAsk, onSearch,
  onReplyClick, onForwardClick, onTranslate, translating, onArchive,
}: EmailHeaderProps) {
  const [deleting, setDeleting] = useState(false)
  const [showSnooze, setShowSnooze] = useState(false)
  const [snoozeDate, setSnoozeDate] = useState('')
  const [showContact, setShowContact] = useState(false)
  const [showRemind, setShowRemind] = useState(false)
  const [remindDays, setRemindDays] = useState<number | null>(null)
  const [remindMsg, setRemindMsg] = useState('')
  const [showEventModal, setShowEventModal] = useState(false)
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventTime, setEventTime] = useState('10:00')
  const [eventDuration, setEventDuration] = useState(1)
  const [eventAttendees, setEventAttendees] = useState('')
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [eventMsg, setEventMsg] = useState('')
  const [unsubUrl, setUnsubUrl] = useState<string | null | undefined>(undefined)
  const [emailProjects, setEmailProjects] = useState<{id: number; name: string; status: string}[]>([])
  const [allProjects, setAllProjects] = useState<{id: number; name: string; status: string}[]>([])
  const [showProjectLinker, setShowProjectLinker] = useState(false)

  useEffect(() => {
    setShowSnooze(false)
    setSnoozeDate('')
    setShowContact(false)
    setShowRemind(false)
    setRemindDays(null)
    setRemindMsg('')
    setShowEventModal(false)
    setEventMsg('')
    setUnsubUrl(undefined)
    setEmailProjects([])
    setShowProjectLinker(false)

    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    setEventTitle(email.subject || '')
    setEventDate(tomorrow.toISOString().slice(0, 10))
    setEventAttendees(email.recipients.join(', '))

    api.getProjectsForEmail(email.id).then(r => setEmailProjects(r.projects)).catch(() => {})
    api.getProjects().then(r => setAllProjects(r.projects)).catch(() => {})
    api.getUnsubscribeUrl(email.id).then(r => setUnsubUrl(r.url)).catch(() => setUnsubUrl(null))
  }, [email.id])

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  const handleRemindMe = async (days: number) => {
    setRemindDays(days)
    const d = new Date()
    d.setDate(d.getDate() + days)
    const remindAt = d.toISOString().slice(0, 10)
    try {
      await api.setFollowupRemind(email.id, remindAt)
      setRemindMsg(`Reminder set for ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`)
      setTimeout(() => { setShowRemind(false); setRemindMsg('') }, 2000)
    } catch {
      setRemindMsg('Failed to set reminder')
    }
    setRemindDays(null)
  }

  const handleSnoozeConfirm = () => {
    if (!snoozeDate) return
    onSnooze?.(email.id, snoozeDate)
    setShowSnooze(false)
    setSnoozeDate('')
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      onDelete(email.id)
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateEvent = async () => {
    setCreatingEvent(true); setEventMsg('')
    try {
      const start = `${eventDate}T${eventTime}:00`
      const endHour = (parseInt(eventTime.split(':')[0]) + eventDuration).toString().padStart(2, '0')
      const end = `${eventDate}T${endHour}:${eventTime.split(':')[1]}:00`
      const attendees = eventAttendees.split(',').map(a => a.trim()).filter(a => a.includes('@'))
      await api.createCalendarEvent(email.id, {
        title: eventTitle,
        start_datetime: start,
        end_datetime: end,
        attendees,
        description: `From email: ${email.subject}`,
      })
      setEventMsg('Event created!'); setTimeout(() => setShowEventModal(false), 1500)
    } catch (e: any) { setEventMsg(e.message || 'Failed') }
    finally { setCreatingEvent(false) }
  }

  return (
    <div className="px-6 py-4 border-b border-gray-100">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900 flex-1 leading-tight pt-0.5">{email.subject || '(no subject)'}</h2>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Primary actions */}
          <Button variant="secondary" size="sm" onClick={onReplyClick}>↩ Reply</Button>
          <Button variant="secondary" size="sm" onClick={onForwardClick}>↪ Fwd</Button>
          <Button variant="primary" size="sm" loading={analyzing} onClick={onAnalyze}>
            {analyzing ? '…' : '✦ AI'}
          </Button>
          {/* Secondary icon-only actions */}
          <div className="flex items-center gap-0.5 ml-1 border-l border-gray-200 pl-1">
            {onAsk && (
              <button onClick={onAsk} title="Ask AI" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-accent transition-colors">
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            <button onClick={onTranslate} disabled={translating} title="Translate" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-40">
              {translating ? <span className="animate-spin inline-block text-[10px]">⟳</span> : <span className="text-sm leading-none">🌐</span>}
            </button>
            {onArchive && (
              <button onClick={onArchive} title="Archive (e)" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <span className="text-sm leading-none">📦</span>
              </button>
            )}
            <EmailNotifyButton emailId={email.id} />
            <button onClick={() => window.print()} title="Print" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <span className="text-sm leading-none">🖨</span>
            </button>
          </div>
          {onSnooze && (
            <>
              <button
                onClick={() => setShowSnooze(s => !s)}
                title="Snooze this email"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-amber-600 px-2 py-1.5 rounded-lg hover:bg-amber-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                <span>Snooze</span>
              </button>
              {showSnooze && (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={snoozeDate}
                    min={tomorrowStr}
                    onChange={e => setSnoozeDate(e.target.value)}
                    className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={handleSnoozeConfirm}
                    disabled={!snoozeDate}
                    className="text-xs bg-amber-500 text-white px-2 py-1 rounded hover:bg-amber-600 disabled:opacity-50"
                  >
                    OK
                  </button>
                  <button onClick={() => setShowSnooze(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                </div>
              )}
            </>
          )}

          {/* Remind me */}
          <div className="relative">
            <button
              onClick={() => setShowRemind(s => !s)}
              title="Set follow-up reminder"
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 px-2 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
              </svg>
              <span>Remind</span>
            </button>
            {showRemind && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-20 min-w-[160px]">
                {remindMsg ? (
                  <p className="text-xs text-green-600 font-medium">{remindMsg}</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 mb-2 font-medium">Remind me in:</p>
                    {[1, 3, 7].map(d => (
                      <button
                        key={d}
                        onClick={() => handleRemindMe(d)}
                        disabled={remindDays !== null}
                        className="block w-full text-left text-xs text-gray-700 hover:text-accent hover:bg-blue-50 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {d === 1 ? 'Tomorrow' : `In ${d} days`}
                      </button>
                    ))}
                    <button onClick={() => setShowRemind(false)} className="mt-1 text-xs text-gray-300 hover:text-gray-500 px-2 py-1">Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Create Calendar Event */}
          <button
            onClick={() => setShowEventModal(s => !s)}
            title="Create calendar event"
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-green-600 px-2 py-1.5 rounded-lg hover:bg-green-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
            </svg>
            <span>Event</span>
          </button>

          {/* Project linker */}
          <div className="relative">
            <button
              onClick={() => setShowProjectLinker(v => !v)}
              title="Link to project"
              className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-colors ${emailProjects.length > 0 ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100' : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2 5a2 2 0 012-2h8a2 2 0 012 2v10a2 2 0 002 2H4a2 2 0 01-2-2V5zm3 1h6v4H5V6zm6 6H5v2h6v-2z" clipRule="evenodd"/><path d="M15 7h1a2 2 0 012 2v5.5a1.5 1.5 0 01-3 0V7z"/></svg>
              <span>{emailProjects.length > 0 ? `${emailProjects.length} project${emailProjects.length > 1 ? 's' : ''}` : 'Project'}</span>
            </button>
            {showProjectLinker && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-20 min-w-[220px]">
                <p className="text-xs font-medium text-gray-600 mb-2">Link to project</p>
                {allProjects.filter(p => p.status !== 'resolved').map(proj => {
                  const linked = emailProjects.some(ep => ep.id === proj.id)
                  return (
                    <button key={proj.id}
                      onClick={async () => {
                        if (linked) {
                          await api.unlinkEmailFromProject(proj.id, email.id).catch(() => {})
                          setEmailProjects(prev => prev.filter(ep => ep.id !== proj.id))
                        } else {
                          await api.linkEmailToProject(proj.id, email.id).catch(() => {})
                          setEmailProjects(prev => [...prev, proj])
                        }
                      }}
                      className={`flex items-center gap-2 w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors ${linked ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                      <span>{linked ? '✓' : '○'}</span>
                      <span className="truncate">{proj.name}</span>
                    </button>
                  )
                })}
                {allProjects.filter(p => p.status !== 'resolved').length === 0 && (
                  <p className="text-xs text-gray-400">No active projects — create one in the Projects tab</p>
                )}
                <button onClick={() => setShowProjectLinker(false)} className="mt-2 text-xs text-gray-300 hover:text-gray-500">Close</button>
              </div>
            )}
          </div>

          {/* Unsubscribe */}
          {unsubUrl && (
            <a
              href={unsubUrl} target="_blank" rel="noreferrer noopener"
              title="Unsubscribe from this sender"
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-orange-600 px-2 py-1.5 rounded-lg hover:bg-orange-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
              </svg>
              <span>Unsub</span>
            </a>
          )}

          {onArchive && (
            <button
              onClick={onArchive}
              title="Archive email (move to Archive folder)"
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >📦 Archive</button>
          )}
          <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>Delete</Button>
        </div>
      </div>

      {/* From / To / Date */}
      <div className="mt-2 space-y-1">
        <div className="flex gap-2 text-sm">
          <span className="text-gray-400 w-12 flex-shrink-0">From</span>
          <div className="relative">
            <button
              onClick={() => setShowContact(s => !s)}
              className="text-gray-800 hover:text-accent hover:underline text-left"
            >
              {email.sender}
            </button>
            {showContact && (
              <ContactCard
                sender={email.sender}
                onClose={() => setShowContact(false)}
                onSearch={onSearch}
              />
            )}
          </div>
        </div>
        {email.recipients.length > 0 && (
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 w-12 flex-shrink-0">To</span>
            <span className="text-gray-700">{email.recipients.join(', ')}</span>
          </div>
        )}
        <div className="flex gap-2 text-sm">
          <span className="text-gray-400 w-12 flex-shrink-0">Date</span>
          <span className="text-gray-500">{formatDateFull(email.date)}</span>
        </div>
      </div>

      {/* Create Event Modal */}
      {showEventModal && (
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 mt-4 -mx-6 -mb-4 flex-shrink-0 animate-slide-up-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Create Calendar Event</h3>
            <button onClick={() => setShowEventModal(false)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
          </div>
          <div className="space-y-2">
            <input value={eventTitle} onChange={e => setEventTitle(e.target.value)} placeholder="Event title"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            <div className="flex gap-2">
              <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
              <input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)}
                className="w-28 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
              <select value={eventDuration} onChange={e => setEventDuration(Number(e.target.value))}
                className="w-24 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white">
                {[0.5,1,1.5,2,3].map(h => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
            <input value={eventAttendees} onChange={e => setEventAttendees(e.target.value)} placeholder="Attendees (comma-separated emails)"
              className="w-full text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            <div className="flex items-center gap-2 justify-end">
              {eventMsg && <span className={`text-xs ${eventMsg.includes('!') ? 'text-green-600' : 'text-red-500'}`}>{eventMsg}</span>}
              <button onClick={handleCreateEvent} disabled={creatingEvent || !eventTitle || !eventDate}
                className="flex items-center gap-1.5 bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors">
                {creatingEvent ? '⟳ Creating…' : 'Create in Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
