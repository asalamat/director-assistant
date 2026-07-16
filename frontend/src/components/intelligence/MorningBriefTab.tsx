import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api/client'
import { useUIContext } from '../../contexts/UIContext'
import type { MorningBrief } from '../../types'

function wishesBody(name: string, type: 'birthday' | 'anniversary'): { subject: string; body: string } {
  const first = (name || '').split(/[\s<]/)[0] || 'there'
  if (type === 'anniversary') {
    return {
      subject: 'Happy work anniversary!',
      body: `Hi ${first},\n\nHappy work anniversary! Wishing you continued success and looking forward to what's ahead.\n\nWarm regards`,
    }
  }
  return {
    subject: 'Happy birthday!',
    body: `Hi ${first},\n\nWishing you a very happy birthday! I hope you have a wonderful day.\n\nWarm regards`,
  }
}

export function MorningBriefTab() {
  const { openCompose } = useUIContext()
  const [brief, setBrief] = useState<MorningBrief | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (force?: boolean) => {
    setLoading(true)
    setError('')
    try {
      const data = await api.getMorningBrief(force)
      setBrief(data)
    } catch (e: any) {
      setError(e?.message || 'Could not load morning brief')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const generatedTime = brief?.generated_at
    ? new Date(brief.generated_at).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : ''

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-64 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-40 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 max-w-md mx-auto text-center mt-16">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{error}</p>
        <button
          onClick={() => load()}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!brief || (brief.sections.length === 0 && !brief.focus)) {
    return (
      <div className="p-6 max-w-md mx-auto text-center mt-16">
        <div className="text-4xl mb-3">☀️</div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">No brief yet. Generate your morning briefing.</p>
        <button
          onClick={() => load(true)}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors"
        >
          Generate Brief
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 tracking-tight">{brief.greeting}</h1>
          {generatedTime && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {generatedTime}{brief.cached ? ' · cached' : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:text-accent-600 border border-gray-200 dark:border-gray-700 hover:border-accent-300 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
          Refresh
        </button>
      </div>

      {brief.focus && (
        <div className="mb-6 rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 text-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/70 mb-1">Today's Focus</p>
          <p className="text-base font-semibold leading-snug">{brief.focus}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {brief.sections.map(section => {
          // Hide the occasions card entirely when there is nothing today
          if (section.id === 'occasions' && section.items.length === 0) return null
          if (section.id === 'occasions') {
            return (
              <div key={section.id} className="rounded-xl border border-pink-100 dark:border-pink-900/50 bg-pink-50/50 dark:bg-pink-950/20 overflow-hidden shadow-sm flex flex-col md:col-span-2">
                <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                  <span className="text-lg leading-none">{section.icon}</span>
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{section.title}</h2>
                </div>
                <div className="px-4 pb-4 flex flex-wrap gap-2">
                  {section.items.map((item, i) => {
                    const type = item.occasion_type || 'birthday'
                    const rawName = item.text.replace(/^[🎂🎉]\s*/, '')
                    return (
                      <div key={i} className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-pink-200 dark:border-pink-800 rounded-full pl-3 pr-1.5 py-1 shadow-sm">
                        <span className="text-sm">{type === 'anniversary' ? '🎉' : '🎂'}</span>
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{rawName}</span>
                        <span className="text-[10px] text-gray-400">{item.meta}</span>
                        {item.email && (
                          <button
                            onClick={() => { const w = wishesBody(rawName, type); openCompose({ to: item.email!, subject: w.subject, body: w.body }) }}
                            className="text-[11px] font-semibold text-white bg-pink-500 hover:bg-pink-600 rounded-full px-2.5 py-1 transition-colors"
                          >
                            Send wishes
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          }
          return (
          <div key={section.id} className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden shadow-sm flex flex-col">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <span className="text-lg leading-none">{section.icon}</span>
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{section.title}</h2>
            </div>
            <ul className="px-4 pb-3 space-y-2 flex-1">
              {section.items.length === 0 && (
                <li className="text-xs text-gray-400 italic">Nothing here.</li>
              )}
              {section.items.map((item, i) => (
                <li key={i} className="text-sm leading-snug">
                  <span className="font-semibold text-gray-800 dark:text-gray-100">{item.text}</span>
                  {item.meta && <span className="text-gray-400 dark:text-gray-500"> — {item.meta}</span>}
                </li>
              ))}
            </ul>
            {section.insight && (
              <p className="text-xs italic text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-4 py-2.5 border-t border-blue-100 dark:border-blue-900/50">
                {section.insight}
              </p>
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}
