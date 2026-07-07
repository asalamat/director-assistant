import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { WeatherData } from '../types'

/** Compact weather chip for the header. Shows temp + emoji; click toggles °C/°F. */
export function WeatherWidget() {
  const [data, setData] = useState<WeatherData | null>(null)
  const [unit, setUnit] = useState<'C' | 'F'>('C')

  const load = useCallback(() => {
    api.getWeather()
      .then(d => {
        setData(d)
        if (d.unit === 'F' || d.unit === 'C') setUnit(d.unit)
      })
      .catch(() => setData(null))
  }, [])

  useEffect(() => {
    load()
    // Refresh every 15 minutes
    const id = setInterval(load, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [load])

  if (!data || !data.configured || data.temp_c == null) return null

  const toF = (c: number) => Math.round(c * 9 / 5 + 32)
  const temp = unit === 'C' ? Math.round(data.temp_c) : toF(data.temp_c)
  const feels = data.feels_c != null ? (unit === 'C' ? Math.round(data.feels_c) : toF(data.feels_c)) : null
  const w = data.weather

  return (
    <button
      onClick={() => setUnit(u => (u === 'C' ? 'F' : 'C'))}
      title={`${data.location || 'Weather'} · ${w?.label ?? ''}${feels != null ? ` · Feels ${feels}°${unit}` : ''}${data.humidity != null ? ` · ${data.humidity}% humidity` : ''}${data.wind_kmh != null ? ` · ${Math.round(data.wind_kmh)} km/h wind` : ''}\nClick to switch to °${unit === 'C' ? 'F' : 'C'}`}
      className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded-lg transition-colors"
    >
      <span className="text-sm leading-none">{w?.emoji ?? '🌡️'}</span>
      <span className="font-semibold tabular-nums">{temp}°{unit}</span>
      {data.location && (
        <span className="text-gray-400 hidden lg:inline max-w-[120px] truncate">
          {data.location.split(',')[0]}
        </span>
      )}
    </button>
  )
}
