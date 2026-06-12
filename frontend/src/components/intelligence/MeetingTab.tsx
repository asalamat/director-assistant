import { useState, useRef, useEffect } from 'react'
import { api } from '../../api/client'

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

export function MeetingTab() {
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

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-6">
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
  )
}
