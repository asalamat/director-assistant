import { useState } from 'react'

interface Props {
  onSnooze: (wakeDate?: string, setAside?: boolean) => void
  onClose: () => void
}

function fmt(d: Date): string {
  // Local ISO datetime (YYYY-MM-DDTHH:MM:SS) the backend accepts via fromisoformat
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

function todayAfternoon(): Date {
  const d = new Date()
  d.setHours(15, 0, 0, 0)
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
  return d
}

function tomorrowMorning(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d
}

function nextWeek(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  d.setHours(8, 0, 0, 0)
  return d
}

export function SnoozePanel({ onSnooze, onClose }: Props) {
  const [showCustom, setShowCustom] = useState(false)
  const [customDate, setCustomDate] = useState('')

  const tomorrowStr = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })()

  const opt = (label: string, hint: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg hover:bg-amber-50 transition-colors"
    >
      <span className="text-sm text-gray-700">{label}</span>
      <span className="text-xs text-gray-400">{hint}</span>
    </button>
  )

  return (
    <div className="absolute z-20 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-1.5">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Snooze until</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>
      {opt('Today, afternoon', '3:00 PM', () => onSnooze(fmt(todayAfternoon())))}
      {opt('Tomorrow morning', '8:00 AM', () => onSnooze(fmt(tomorrowMorning())))}
      {opt('Next week', '7 days', () => onSnooze(fmt(nextWeek())))}
      {!showCustom ? (
        opt('Pick a date…', '', () => setShowCustom(true))
      ) : (
        <div className="flex items-center gap-1 px-2 py-2">
          <input
            type="date"
            value={customDate}
            min={tomorrowStr}
            onChange={e => setCustomDate(e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={() => customDate && onSnooze(customDate)}
            disabled={!customDate}
            className="text-xs bg-amber-500 text-white px-2 py-1 rounded hover:bg-amber-600 disabled:opacity-50"
          >
            OK
          </button>
        </div>
      )}
      <div className="border-t border-gray-100 my-1" />
      <button
        onClick={() => onSnooze(undefined, true)}
        className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg hover:bg-indigo-50 transition-colors"
      >
        <span className="text-sm text-gray-700">Set aside</span>
        <span className="text-xs text-gray-400">no date</span>
      </button>
    </div>
  )
}
