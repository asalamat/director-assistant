import { useState, useRef, useEffect } from 'react'
import { api } from '../../api/client'
import { MeetingNotesPanel } from '../MeetingNotesPanel'
import { useUIContext } from '../../contexts/UIContext'
import { addToast } from '../Toast'

type MeetingMode = 'agenda' | 'notes' | 'record'

interface AgendaItem { title: string; duration_mins: number; type: string; points: string[]; questions: string[] }
interface AgendaResult {
  title: string; attendees: string[]; duration_mins: number;
  pre_meeting_prep: string[];
  agenda_items: AgendaItem[];
  success_criteria: string;
  follow_up_template: string;
}

const TYPE_COLOR: Record<string, string> = {
  update: 'bg-blue-50 text-blue-700 border-blue-200',
  decision: 'bg-purple-50 text-purple-700 border-purple-200',
  discussion: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  'action-review': 'bg-green-50 text-green-700 border-green-200',
  intro: 'bg-gray-50 text-gray-600 border-gray-200',
  'wrap-up': 'bg-gray-50 text-gray-600 border-gray-200',
}

function AgendaPanel() {
  const { openCompose } = useUIContext()
  const [meetTitle, setMeetTitle] = useState('')
  const [attendeeInput, setAttendeeInput] = useState('')
  const [attendees, setAttendees] = useState<string[]>([])
  const [duration, setDuration] = useState(60)
  const [notes, setNotes] = useState('')
  const [building, setBuilding] = useState(false)
  const [result, setResult] = useState<AgendaResult | null>(null)
  const [suggestions, setSuggestions] = useState<{ name: string; email: string }[]>([])
  const [showSugg, setShowSugg] = useState(false)

  // Load stakeholders once for typeahead
  useEffect(() => {
    api.getStakeholders(90).then(r => {
      setSuggestions(r.stakeholders.map(s => ({ name: s.name || s.email, email: s.email })))
    }).catch(() => {})
  }, [])

  const filteredSugg = attendeeInput.trim().length > 0
    ? suggestions.filter(s =>
        (s.name.toLowerCase().includes(attendeeInput.toLowerCase()) ||
         s.email.toLowerCase().includes(attendeeInput.toLowerCase())) &&
        !attendees.includes(s.name || s.email)
      ).slice(0, 6)
    : []

  const addAttendee = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && !attendees.includes(trimmed)) {
      setAttendees(prev => [...prev, trimmed])
    }
    setAttendeeInput('')
    setShowSugg(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addAttendee(attendeeInput)
    } else if (e.key === 'Backspace' && !attendeeInput) {
      setAttendees(prev => prev.slice(0, -1))
    }
  }

  const handleBuild = async () => {
    if (!meetTitle.trim()) return
    setBuilding(true)
    setResult(null)
    try {
      const res = await api.buildAgenda({
        title: meetTitle.trim(),
        attendees,
        duration_mins: duration,
        context_notes: notes.trim() || undefined,
      })
      setResult(res)
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Agenda generation failed', 'warning')
    } finally {
      setBuilding(false)
    }
  }

  const totalMins = result?.agenda_items.reduce((s, i) => s + i.duration_mins, 0) ?? 0

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: form */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-gray-100 dark:border-gray-700 p-4 gap-3 overflow-y-auto">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Meeting title</label>
          <input
            value={meetTitle}
            onChange={e => setMeetTitle(e.target.value)}
            placeholder="Q3 review with Sarah…"
            className="mt-1 w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Duration</label>
          <div className="mt-1 flex gap-1 flex-wrap">
            {[15, 30, 45, 60, 90].map(d => (
              <button key={d} onClick={() => setDuration(d)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${duration === d ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                {d}m
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Attendees</label>
          <div className="mt-1 flex flex-wrap gap-1 p-2 border border-gray-200 rounded-lg dark:border-gray-600 dark:bg-gray-800 min-h-[2.5rem]">
            {attendees.map(a => (
              <span key={a} className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                {a}
                <button onClick={() => setAttendees(prev => prev.filter(x => x !== a))} className="text-blue-400 hover:text-blue-700">×</button>
              </span>
            ))}
            <input
              value={attendeeInput}
              onChange={e => { setAttendeeInput(e.target.value); setShowSugg(true) }}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowSugg(true)}
              onBlur={() => setTimeout(() => setShowSugg(false), 150)}
              placeholder={attendees.length ? '' : 'Name or email…'}
              className="flex-1 min-w-[80px] text-xs outline-none bg-transparent dark:text-gray-100"
            />
          </div>
          {showSugg && filteredSugg.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
              {filteredSugg.map(s => (
                <button key={s.email} onMouseDown={() => addAttendee(s.name || s.email)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700">
                  <span className="font-medium text-gray-800 dark:text-gray-200">{s.name}</span>
                  <span className="text-gray-400 ml-1">{s.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Context notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Topics you want to cover, recent issues, goals…"
            rows={4}
            className="mt-1 w-full text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
          />
        </div>

        <button
          onClick={handleBuild}
          disabled={building || !meetTitle.trim()}
          className="w-full bg-blue-600 text-white text-xs font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {building ? 'Building agenda…' : 'Build Agenda'}
        </button>
      </div>

      {/* Right: result */}
      <div className="flex-1 overflow-y-auto">
        {!result && !building && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <svg className="w-12 h-12 opacity-30" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
            </svg>
            <p className="text-sm">Fill in meeting details and click <span className="font-medium text-blue-500">Build Agenda</span></p>
            <p className="text-xs text-gray-300 text-center px-12">AI will pull context from your emails and open follow-ups to build a smart agenda</p>
          </div>
        )}

        {building && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Building your agenda…</p>
            <p className="text-xs text-gray-400">Pulling email context + open follow-ups</p>
          </div>
        )}

        {result && (
          <div className="p-6 space-y-5 max-w-2xl">
            {/* Header */}
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{result.title}</h2>
              <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                <span>{result.duration_mins} min</span>
                {result.attendees.length > 0 && <span>{result.attendees.join(', ')}</span>}
                {totalMins !== result.duration_mins && (
                  <span className="text-amber-500">(items total {totalMins}m)</span>
                )}
              </div>
              {result.success_criteria && (
                <p className="mt-1.5 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-1.5 border border-green-100">
                  Goal: {result.success_criteria}
                </p>
              )}
            </div>

            {/* Pre-meeting prep */}
            {result.pre_meeting_prep.length > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-amber-800 mb-2">Before the meeting</h3>
                <ul className="space-y-1">
                  {result.pre_meeting_prep.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                      <span className="mt-0.5 flex-shrink-0">□</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Agenda items */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Agenda</h3>
              {result.agenda_items.map((item, i) => (
                <div key={i} className={`rounded-xl border p-4 ${TYPE_COLOR[item.type] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-medium">{item.title}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs opacity-60 capitalize">{item.type.replace('-', ' ')}</span>
                      <span className="text-xs font-semibold">{item.duration_mins}m</span>
                    </div>
                  </div>
                  {item.points.length > 0 && (
                    <ul className="space-y-0.5 mb-2">
                      {item.points.map((p, j) => (
                        <li key={j} className="text-xs opacity-80 flex gap-1.5">
                          <span className="flex-shrink-0">·</span>{p}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.questions.length > 0 && (
                    <div className="mt-2 border-t border-current border-opacity-10 pt-2 space-y-0.5">
                      {item.questions.map((q, j) => (
                        <p key={j} className="text-xs opacity-70 italic">? {q}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => {
                  const text = [
                    result.title,
                    `${result.duration_mins} min | ${result.attendees.join(', ')}`,
                    '',
                    ...result.agenda_items.map(i => `${i.duration_mins}m — ${i.title}\n${i.points.map(p => `  · ${p}`).join('\n')}`),
                    '',
                    result.success_criteria ? `Goal: ${result.success_criteria}` : '',
                  ].filter(l => l !== undefined).join('\n')
                  navigator.clipboard.writeText(text)
                  addToast('Agenda copied', 'success')
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
              >
                Copy agenda
              </button>
              {result.follow_up_template && (
                <button
                  onClick={() => openCompose({ subject: `Follow-up: ${result.title}`, body: result.follow_up_template })}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  Draft follow-up email
                </button>
              )}
              <button
                onClick={() => setResult(null)}
                className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-600 ml-auto"
              >
                New agenda
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type RecState = 'idle' | 'recording' | 'processing' | 'done' | 'error'

interface MeetingResult {
  transcript: string
  action_items: string[]
  draft_email: string
}

interface RecordingEntry {
  id: number
  recorded_at: string
  duration_secs: number
  title: string
  preview: string
}

interface RecordingDetail {
  id: number
  transcript: string
  action_items: string[]
  draft_email: string
  title: string
  recorded_at: string
}

const MODES: { id: MeetingMode; label: string }[] = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'notes',  label: 'Notes' },
  { id: 'record', label: 'Record' },
]

export function MeetingTab() {
  const [mode, setMode] = useState<MeetingMode>('agenda')
  const [state, setState] = useState<RecState>('idle')
  const [timer, setTimer] = useState(0)
  const [result, setResult] = useState<MeetingResult | null>(null)
  const [error, setError] = useState('')
  const [savingIdx, setSavingIdx] = useState<number | null>(null)
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<RecordingDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef = useRef(0)

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    } catch {
      return iso
    }
  }

  const loadRecordings = () => {
    api.listMeetingRecordings().then(r => setRecordings(r.recordings)).catch(() => {})
  }

  useEffect(() => {
    loadRecordings()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const MAX_SECS = 90 * 60  // 90 min — backend now chunks audio if >24 MB

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      durationRef.current = 0
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const elapsed = durationRef.current
        setState('processing')
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        try {
          const r = await api.transcribeMeeting(blob)
          setResult(r)
          setState('done')
          // Server auto-saves on transcribe; just refresh history
          loadRecordings()
        } catch (err: any) {
          setError(err.message || 'Transcription failed')
          setState('error')
        }
      }
      mr.start(1000)
      mediaRef.current = mr
      setTimer(0)
      setState('recording')
      timerRef.current = setInterval(() => {
        setTimer(t => {
          const next = t + 1
          if (next >= MAX_SECS) {
            // Auto-stop at limit
            if (timerRef.current) clearInterval(timerRef.current)
            mediaRef.current?.stop()
          }
          return next
        })
        durationRef.current += 1
      }, 1000)
    } catch (err: any) {
      setError(err.message || 'Microphone access denied')
      setState('error')
    }
  }

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    mediaRef.current?.stop()
  }

  const saveAction = async (text: string, idx: number) => {
    setSavingIdx(idx)
    try { await api.addActionItem('meeting', 'Meeting Recording', [text]) } catch {}
    setSavingIdx(null)
  }

  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
      setExpandedDetail(null)
      return
    }
    setExpandedId(id)
    setExpandedDetail(null)
    setLoadingDetail(true)
    try {
      const d = await api.getMeetingRecording(id)
      setExpandedDetail(d)
    } catch {
      setExpandedDetail(null)
    }
    setLoadingDetail(false)
  }

  const deleteRecording = async (id: number) => {
    setDeletingId(id)
    try {
      await api.deleteMeetingRecording(id)
      setRecordings(prev => prev.filter(r => r.id !== id))
      if (expandedId === id) { setExpandedId(null); setExpandedDetail(null) }
    } catch {}
    setDeletingId(null)
  }

  const TabBar = () => (
    <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
      {MODES.map(m => (
        <button key={m.id} onClick={() => setMode(m.id)}
          className={`text-xs font-medium px-3 py-2 border-b-2 transition-colors ${mode === m.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          {m.label}
        </button>
      ))}
    </div>
  )

  if (mode === 'agenda') {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <TabBar />
        <div className="flex-1 overflow-hidden min-h-0"><AgendaPanel /></div>
      </div>
    )
  }

  if (mode === 'notes') {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <TabBar />
        <div className="flex-1 overflow-hidden min-h-0">
          <MeetingNotesPanel />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TabBar />
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Meeting Intelligence</h2>
        <p className="text-xs text-gray-500 mt-0.5">Record a meeting or call — AI transcribes it and extracts action items + follow-up draft.</p>
      </div>

      {/* Record controls */}
      {state === 'idle' && (
        <button onClick={start}
          className="flex items-center gap-2 px-5 py-3 bg-accent text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-medium w-fit">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
          </svg>
          Start Recording
        </button>
      )}

      {state === 'recording' && (
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-red-500 font-medium text-sm">
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            Recording — {fmt(timer)}
            {timer >= MAX_SECS - 300 && timer < MAX_SECS && (
              <span className="text-xs text-amber-500 ml-2">({Math.ceil((MAX_SECS - timer) / 60)}m remaining)</span>
            )}
          </span>
          <button onClick={stop}
            className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm transition-colors">
            Stop
          </button>
        </div>
      )}

      {state === 'processing' && (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <span className="w-4 h-4 border-2 border-gray-300 border-t-accent rounded-full animate-spin" />
          Transcribing with Whisper…
        </div>
      )}

      {state === 'error' && (
        <div className="space-y-2">
          <p className="text-red-500 text-sm">{error}</p>
          <button onClick={() => setState('idle')} className="text-xs text-accent hover:underline">Try again</button>
        </div>
      )}

      {state === 'done' && result && (
        <div className="space-y-5">
          {/* Action items */}
          {result.action_items.length > 0 && (
            <div className="border border-gray-200 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-800">Action Items</h3>
              {result.action_items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="mt-0.5 text-gray-400 flex-shrink-0">•</span>
                  <span className="flex-1">{item}</span>
                  <button onClick={() => saveAction(item, i)} disabled={savingIdx === i}
                    className="text-[10px] text-accent hover:underline flex-shrink-0 disabled:opacity-50">
                    {savingIdx === i ? '…' : '+ Actions'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Draft follow-up */}
          {result.draft_email && (
            <div className="border border-gray-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">Follow-up Draft</h3>
                <button onClick={() => navigator.clipboard.writeText(result.draft_email).catch(() => {})}
                  className="text-xs text-gray-400 hover:text-accent border border-gray-200 rounded px-2 py-0.5">Copy</button>
              </div>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{result.draft_email}</pre>
            </div>
          )}

          {/* Transcript */}
          <details className="border border-gray-100 rounded-xl">
            <summary className="px-4 py-3 text-sm text-gray-500 cursor-pointer hover:bg-gray-50 rounded-xl">
              View transcript ({result.transcript.split(' ').length} words)
            </summary>
            <pre className="px-4 pb-4 text-xs text-gray-600 whitespace-pre-wrap leading-relaxed font-mono">{result.transcript}</pre>
          </details>

          <button onClick={() => { setResult(null); setState('idle'); setTimer(0) }}
            className="text-sm text-gray-400 hover:text-accent">New recording</button>
        </div>
      )}

      {/* Past recordings history */}
      {recordings.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Past Recordings</h3>
          <div className="space-y-2">
            {recordings.slice(0, 5).map(rec => (
              <div key={rec.id} className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => toggleExpand(rec.id)}>
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{rec.title}</p>
                    <p className="text-xs text-gray-400">{fmtDate(rec.recorded_at)}{rec.duration_secs > 0 ? ` · ${fmt(rec.duration_secs)}` : ''}</p>
                    {expandedId !== rec.id && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">{rec.preview}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); deleteRecording(rec.id) }}
                      disabled={deletingId === rec.id}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50 px-1">
                      {deletingId === rec.id ? '…' : 'Delete'}
                    </button>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedId === rec.id ? 'rotate-180' : ''}`}
                      viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>

                {expandedId === rec.id && (
                  <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50">
                    {loadingDetail && !expandedDetail && (
                      <div className="flex items-center gap-2 text-gray-400 text-xs">
                        <span className="w-3 h-3 border-2 border-gray-300 border-t-accent rounded-full animate-spin" />
                        Loading…
                      </div>
                    )}
                    {expandedDetail && (
                      <>
                        {expandedDetail.action_items.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-600 mb-1">Action Items</p>
                            <ul className="space-y-1">
                              {expandedDetail.action_items.map((item, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700">
                                  <span className="text-gray-400 mt-0.5">•</span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {expandedDetail.draft_email && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs font-semibold text-gray-600">Follow-up Draft</p>
                              <button onClick={() => navigator.clipboard.writeText(expandedDetail.draft_email).catch(() => {})}
                                className="text-[10px] text-gray-400 hover:text-accent border border-gray-200 rounded px-1.5 py-0.5">Copy</button>
                            </div>
                            <pre className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">{expandedDetail.draft_email}</pre>
                          </div>
                        )}
                        <details className="border border-gray-200 rounded-lg">
                          <summary className="px-3 py-2 text-xs text-gray-500 cursor-pointer hover:bg-gray-100 rounded-lg">
                            View transcript ({expandedDetail.transcript.split(' ').length} words)
                          </summary>
                          <pre className="px-3 pb-3 text-xs text-gray-600 whitespace-pre-wrap leading-relaxed font-mono">{expandedDetail.transcript}</pre>
                        </details>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
