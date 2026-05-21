import { useState, useEffect, useCallback } from 'react'

export interface ToastItem {
  id: number
  message: string
  type?: 'info' | 'success' | 'warning'
}

let _addToast: ((msg: string, type?: ToastItem['type']) => void) | null = null

export function addToast(msg: string, type: ToastItem['type'] = 'info') {
  _addToast?.(msg, type)
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const add = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  useEffect(() => {
    _addToast = add
    return () => { _addToast = null }
  }, [add])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-slide-up pointer-events-auto
            ${t.type === 'success' ? 'bg-green-600 text-white' :
              t.type === 'warning' ? 'bg-amber-500 text-white' :
              'bg-gray-900 text-white'}`}
        >
          <span>{t.type === 'success' ? '✓' : t.type === 'warning' ? '⚠' : '●'}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
