import { useState, useRef, useEffect } from 'react'
import { api } from '../../api/client'

type RecState = 'idle' | 'recording' | 'processing' | 'done' | 'error'

interface MeetingResult {
  transcript: string
  action_items: string[]
  draft_email: string
}

export function MeetingTab() {
  const [state, setState] = useState<RecState>('idle')
  const [timer, setTimer] = useState(0)
  const [result, setResult] = useState<MeetingResult | null>(null)
  const [error, setError] = useState('')
  const [savingIdx, setSavingIdx] = useState<number | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setState('processing')
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        try {
          const r = await api.transcribeMeeting(blob)
          setResult(r)
          setState('done')
        } catch (err: any) {
          setError(err.message || 'Transcription failed')
          setState('error')
        }
      }
      mr.start(1000)
      mediaRef.current = mr
      setTimer(0)
      setState('recording')
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000)
    } catch (err: any) {
      setError(err.message || 'Microphone access denied')
      setState('error')
    }
  }

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    mediaRef.current?.stop()
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const saveAction = async (text: string, idx: number) => {
    setSavingIdx(idx)
    try { await api.addActionItem('meeting', 'Meeting Recording', [text]) } catch {}
    setSavingIdx(null)
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
    </div>
  )
}
