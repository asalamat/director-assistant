import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { AppConfig, WeatherResult } from '../types'

interface Props {
  config: AppConfig | null
  onChange: (patch: Partial<AppConfig>) => void
}

/** Settings card: search a city, save its coordinates, pick °C / °F. */
export function WeatherSettings({ config, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WeatherResult[]>([])
  const [searching, setSearching] = useState(false)
  const [msg, setMsg] = useState('')
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const unit = (config?.weather_unit === 'F' ? 'F' : 'C') as 'C' | 'F'
  const savedLocation = config?.weather_location || ''

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api.searchWeatherLocation(q)
        setResults(r.results)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query])

  const pick = async (loc: WeatherResult) => {
    await api.updateConfig({
      weather_location: loc.label,
      weather_lat: loc.latitude,
      weather_lon: loc.longitude,
    })
    onChange({ weather_location: loc.label, weather_lat: loc.latitude, weather_lon: loc.longitude })
    setQuery('')
    setResults([])
    setMsg(`Location set to ${loc.label}`)
    setTimeout(() => setMsg(''), 2500)
  }

  const setUnit = async (u: 'C' | 'F') => {
    await api.updateConfig({ weather_unit: u })
    onChange({ weather_unit: u })
  }

  const clear = async () => {
    await api.updateConfig({ weather_location: '', weather_lat: null, weather_lon: null })
    onChange({ weather_location: '', weather_lat: null, weather_lon: null })
    setMsg('Location cleared')
    setTimeout(() => setMsg(''), 2500)
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-gray-800 mb-1">🌤️ Weather</h2>
      <p className="text-xs text-gray-500 mb-3">Show current conditions for your location in the header. Powered by Open-Meteo (free, no API key).</p>

      {savedLocation && (
        <div className="flex items-center gap-2 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span className="text-sm text-blue-800 flex-1">📍 {savedLocation}</span>
          <button onClick={clear} className="text-xs text-blue-500 hover:text-blue-700 underline">Change</button>
        </div>
      )}

      <div className="relative mb-3">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={savedLocation ? 'Search a new city…' : 'Search your city (e.g. Toronto)…'}
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
        />
        {searching && <span className="absolute right-3 top-2.5 text-xs text-gray-400">Searching…</span>}
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            {results.map((r, i) => (
              <button
                key={`${r.latitude},${r.longitude},${i}`}
                onClick={() => pick(r)}
                className="w-full text-left text-sm px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">Display units:</span>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(['C', 'F'] as const).map(u => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                unit === u ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              °{u}
            </button>
          ))}
        </div>
        {msg && <span className="text-xs text-green-600 ml-auto">{msg}</span>}
      </div>
    </div>
  )
}
