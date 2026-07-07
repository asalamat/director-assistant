import { useState, useRef } from 'react'
import { api } from '../api/client'

interface Props {
  onTranscript: (text: string) => void
}

type State = 'idle' | 'recording' | 'transcribing'

function pickMime(): { mime: string; ext: string } {
  if (typeof MediaRecorder !== 'undefined') {
    if (MediaRecorder.isTypeSupported('audio/webm')) return { mime: 'audio/webm', ext: 'webm' }
    if (MediaRecorder.isTypeSupported('audio/mp4')) return { mime: 'audio/mp4', ext: 'mp4' }
  }
  return { mime: '', ext: 'webm' }
}

export function VoiceDictation({ onTranscript }: Props) {
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const start = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const { mime, ext } = pickMime()
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stopStream()
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
        if (blob.size === 0) { setState('idle'); return }
        setState('transcribing')
        try {
          const r = await api.transcribeAudio(blob, `dictation.${ext}`)
          const text = (r.cleaned || r.transcript || '').trim()
          if (text) onTranscript(text)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Transcription failed.')
        } finally {
          setState('idle')
        }
      }
      recorder.start()
      recorderRef.current = recorder
      setState('recording')
    } catch {
      setError('Microphone access denied.')
      setState('idle')
    }
  }

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    } else {
      stopStream()
      setState('idle')
    }
  }

  const label =
    state === 'recording' ? 'Stop recording' :
    state === 'transcribing' ? 'Transcribing' : 'Dictate'

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        title={label}
        onClick={state === 'recording' ? stop : state === 'idle' ? start : undefined}
        disabled={state === 'transcribing'}
        className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
          state === 'recording'
            ? 'bg-red-500 text-white animate-pulse'
            : 'text-gray-400 hover:text-accent hover:bg-gray-100'
        } disabled:opacity-50`}
      >
        {state === 'recording' ? '◼' : state === 'transcribing' ? <span className="animate-spin inline-block">⟳</span> : '🎤'}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </span>
  )
}
