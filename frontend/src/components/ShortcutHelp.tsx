import { useState, useEffect } from 'react'

const SHORTCUTS = [
  { key: '?', desc: 'Show keyboard shortcuts' },
  { key: 'Cmd+K', desc: 'Open command palette' },
  { key: 'r', desc: 'Reply to selected email' },
  { key: 'f', desc: 'Forward selected email' },
  { key: 'Escape', desc: 'Close panel / deselect' },
  { key: '↑ / ↓', desc: 'Navigate email list' },
  { key: 'Enter', desc: 'Open selected email' },
]

export function ShortcutHelp() {
  const [open, setOpen] = useState(false)

  // Keyboard trigger disabled — use ? button to open instead

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setOpen(false)}>
        <div className="bg-white rounded-2xl shadow-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-800">Keyboard Shortcuts</h3>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
          <div className="space-y-2">
            {SHORTCUTS.map(s => (
              <div key={s.key} className="flex items-center justify-between">
                <span className="text-xs text-gray-600">{s.desc}</span>
                <kbd className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-mono border border-gray-200">{s.key}</kbd>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-4 text-center">Press ? to toggle</p>
        </div>
      </div>
    </>
  )
}
