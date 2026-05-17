import { useState, useEffect } from 'react'
import { api } from '../api/client'

interface Props {
  onSelect: (path: string) => void
  onClose: () => void
}

export function FolderPicker({ onSelect, onClose }: Props) {
  const [current, setCurrent] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const navigate = async (path?: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await api.browseFolder(path)
      setCurrent(res.current)
      setParent(res.parent)
      setDirs(res.dirs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load folder')
    }
    setLoading(false)
  }

  useEffect(() => { navigate() }, [])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-[480px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">Select Folder</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {/* Current path */}
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
          {parent && (
            <button
              onClick={() => navigate(parent)}
              className="flex-shrink-0 text-gray-500 hover:text-gray-800 p-1 rounded hover:bg-gray-200"
              title="Go up"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          )}
          <span className="text-xs text-gray-500 font-mono truncate flex-1">{current}</span>
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400 text-sm">Loading…</div>
          )}
          {error && (
            <div className="text-center py-8 text-red-400 text-sm">{error}</div>
          )}
          {!loading && !error && dirs.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              No subfolders — click <span className="font-medium text-gray-500">Select</span> to use this folder
            </div>
          )}
          {!loading && dirs.map(d => (
            <div key={d.path} className="flex items-center gap-1 group">
              <button
                onClick={() => navigate(d.path)}
                className="flex-1 flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-left min-w-0"
              >
                <svg className="w-4 h-4 text-amber-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                <span className="text-sm text-gray-700 flex-1 truncate">{d.name}</span>
                <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={() => { onSelect(d.path); onClose() }}
                className="opacity-0 group-hover:opacity-100 flex-shrink-0 px-2 py-1 text-xs text-accent border border-accent rounded-md hover:bg-blue-50 transition-opacity mr-1"
                title={`Select ${d.name}`}
              >
                Use
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400 truncate font-mono flex-1">{current}</span>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={() => { onSelect(current); onClose() }}
              className="px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-blue-700"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
