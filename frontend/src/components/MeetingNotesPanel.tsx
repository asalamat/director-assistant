import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useUIContext } from '../contexts/UIContext'
import { addToast } from './Toast'

interface ActionItem { task: string; owner: string; deadline: string; priority: string }
interface FollowUpEmail { to: string; subject: string; body: string }
interface CalendarEvent { title: string; date_hint: string; duration_mins: number; attendees: string[] }

interface AnalysisResult {
  id?: number
  title: string
  summary: string
  action_items: ActionItem[]
  decisions: string[]
  follow_up_emails: FollowUpEmail[]
  calendar_events: CalendarEvent[]
}

interface HistoryItem {
  id: number
  recorded_at: string
  title: string
  preview: string
}

type ResultTab = 'actions' | 'decisions' | 'emails' | 'events'

const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
}

export function MeetingNotesPanel() {
  const { openCompose } = useUIContext()

  const [notes, setNotes] = useState('')
  const [title, setTitle] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [resultTab, setResultTab] = useState<ResultTab>('actions')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [addedTasks, setAddedTasks] = useState<Set<number>>(new Set())
  const [createdEvents, setCreatedEvents] = useState<Set<number>>(new Set())

  useEffect(() => { loadHistory() }, [])

  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      const res = await api.listMeetingRecordings()
      setHistory(res.recordings)
    } catch { /* silent */ }
    finally { setLoadingHistory(false) }
  }

  const handleAnalyze = async () => {
    if (!notes.trim()) return
    setAnalyzing(true)
    setResult(null)
    try {
      const res = await api.analyzeMeetingNotes(notes.trim(), title.trim() || undefined)
      setResult(res)
      setResultTab(res.action_items.length > 0 ? 'actions' : res.decisions.length > 0 ? 'decisions' : 'emails')
      setAddedTasks(new Set())
      setCreatedEvents(new Set())
      loadHistory()
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Analysis failed', 'warning')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleAddTask = async (item: ActionItem, idx: number) => {
    try {
      const note = [item.owner !== 'TBD' ? `Owner: ${item.owner}` : '', item.deadline !== 'TBD' ? `Due: ${item.deadline}` : ''].filter(Boolean).join(' · ')
      await api.createFollowUp({
        email_id: `meeting_${result?.id ?? 0}`,
        subject: item.task,
        sender: item.owner !== 'TBD' ? item.owner : 'Meeting',
        due_date: item.deadline !== 'TBD' ? item.deadline : new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        note,
      })
      setAddedTasks(prev => new Set([...prev, idx]))
      addToast('Added to Actions', 'success')
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Failed to add task', 'warning')
    }
  }

  const handleOpenCompose = (email: FollowUpEmail) => {
    openCompose({ to: email.to, subject: email.subject, body: email.body })
  }

  const handleCopyEvent = (event: CalendarEvent, idx: number) => {
    const text = [
      `Event: ${event.title}`,
      event.date_hint !== 'TBD' ? `When: ${event.date_hint}` : '',
      `Duration: ${event.duration_mins} min`,
      event.attendees.length ? `Attendees: ${event.attendees.join(', ')}` : '',
    ].filter(Boolean).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCreatedEvents(prev => new Set([...prev, idx]))
      addToast('Event details copied', 'success')
    })
  }

  const loadHistoryItem = async (id: number) => {
    try {
      const rec = await api.getMeetingRecording(id)
      setNotes(rec.transcript)
      setTitle(rec.title)
      setResult(null)
    } catch { /* silent */ }
  }

  const tabCount = (tab: ResultTab): number => {
    if (!result) return 0
    if (tab === 'actions') return result.action_items.length
    if (tab === 'decisions') return result.decisions.length
    if (tab === 'emails') return result.follow_up_emails.length
    return result.calendar_events.length
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: input + history */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-gray-100 dark:border-gray-700">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Meeting Notes</h2>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Meeting title (optional)"
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
          />
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Paste or type your meeting notes here…&#10;&#10;Include: attendees, decisions, action items, next steps, dates."
            className="w-full h-48 text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
          />
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !notes.trim()}
            className="mt-2 w-full bg-blue-600 text-white text-xs font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {analyzing ? 'Analyzing…' : 'Extract Action Items'}
          </button>
        </div>

        {/* History */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Recent</div>
          {loadingHistory ? (
            <div className="px-4 text-xs text-gray-400">Loading…</div>
          ) : history.length === 0 ? (
            <div className="px-4 text-xs text-gray-400">No meetings yet</div>
          ) : (
            history.map(h => (
              <button
                key={h.id}
                onClick={() => loadHistoryItem(h.id)}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-50 dark:border-gray-700"
              >
                <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{h.title}</div>
                <div className="text-xs text-gray-400 mt-0.5 truncate">{h.preview}</div>
                <div className="text-xs text-gray-300 mt-0.5">
                  {new Date(h.recorded_at).toLocaleDateString()}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: results */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!result && !analyzing && (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
            <svg className="w-12 h-12 opacity-30" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM7 8H5v2h2V8zm2 0h2v2H9V8zm6 0h-2v2h2V8z" clipRule="evenodd" />
            </svg>
            <div className="text-sm text-center px-8">
              Paste your meeting notes on the left and click<br />
              <span className="font-medium text-blue-500">Extract Action Items</span>
            </div>
            <div className="text-xs text-gray-300 text-center px-12">
              AI will extract action items, decisions, follow-up emails, and calendar events
            </div>
          </div>
        )}

        {analyzing && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm">Analyzing notes…</div>
          </div>
        )}

        {result && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Summary */}
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{result.title}</div>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{result.summary}</p>
            </div>

            {/* Result tabs */}
            <div className="flex border-b border-gray-100 dark:border-gray-700 px-4">
              {(['actions', 'decisions', 'emails', 'events'] as ResultTab[]).map(tab => {
                const labels: Record<ResultTab, string> = { actions: 'Actions', decisions: 'Decisions', emails: 'Emails', events: 'Calendar' }
                const count = tabCount(tab)
                return (
                  <button
                    key={tab}
                    onClick={() => setResultTab(tab)}
                    className={`text-xs font-medium px-3 py-2.5 border-b-2 transition-colors ${resultTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  >
                    {labels[tab]}
                    {count > 0 && <span className="ml-1 bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{count}</span>}
                  </button>
                )
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Action items */}
              {resultTab === 'actions' && (
                result.action_items.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center mt-8">No action items found</div>
                ) : (
                  <div className="space-y-2">
                    {result.action_items.map((item, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-900 dark:text-gray-100">{item.task}</div>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLOR[item.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                              {item.priority}
                            </span>
                            {item.owner !== 'TBD' && (
                              <span className="text-xs text-gray-500">Owner: {item.owner}</span>
                            )}
                            {item.deadline !== 'TBD' && (
                              <span className="text-xs text-gray-500">Due: {item.deadline}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddTask(item, i)}
                          disabled={addedTasks.has(i)}
                          className="flex-shrink-0 text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600"
                        >
                          {addedTasks.has(i) ? '✓ Added' : '+ Tasks'}
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Decisions */}
              {resultTab === 'decisions' && (
                result.decisions.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center mt-8">No decisions recorded</div>
                ) : (
                  <ul className="space-y-2">
                    {result.decisions.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <span className="text-green-500 mt-0.5">✓</span>
                        <span className="text-sm text-gray-800 dark:text-gray-200">{d}</span>
                      </li>
                    ))}
                  </ul>
                )
              )}

              {/* Follow-up emails */}
              {resultTab === 'emails' && (
                result.follow_up_emails.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center mt-8">No follow-up emails needed</div>
                ) : (
                  <div className="space-y-3">
                    {result.follow_up_emails.map((email, i) => (
                      <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <div className="text-xs text-gray-500">To: <span className="font-medium text-gray-700 dark:text-gray-300">{email.to}</span></div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-0.5">{email.subject}</div>
                          </div>
                          <button
                            onClick={() => handleOpenCompose(email)}
                            className="flex-shrink-0 text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                          >
                            Compose
                          </button>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap line-clamp-4 leading-relaxed">
                          {email.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Calendar events */}
              {resultTab === 'events' && (
                result.calendar_events.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center mt-8">No calendar events mentioned</div>
                ) : (
                  <div className="space-y-2">
                    {result.calendar_events.map((event, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{event.title}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-gray-500">
                            {event.date_hint !== 'TBD' && <span>{event.date_hint}</span>}
                            <span>{event.duration_mins} min</span>
                            {event.attendees.length > 0 && (
                              <span>{event.attendees.join(', ')}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleCopyEvent(event, i)}
                          disabled={createdEvents.has(i)}
                          className="flex-shrink-0 text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600"
                        >
                          {createdEvents.has(i) ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
