import { useState } from 'react'
import { LinkedInWizard } from './LinkedInWizard'
import { PostHistory } from './PostHistory'
import { LinkedInTemplates } from './LinkedInTemplates'
import { LinkedInAutopilot } from './LinkedInAutopilot'
import { InstagramWizard } from './InstagramWizard'

type TabId = 'linkedin' | 'autopilot' | 'instagram' | 'ig-history' | 'twitter' | 'history' | 'templates'

export function SocialPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('linkedin')
  const linkedInActive = activeTab === 'linkedin' || activeTab === 'autopilot' || activeTab === 'history' || activeTab === 'templates'
  const instagramActive = activeTab === 'instagram' || activeTab === 'ig-history'

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="w-44 flex-shrink-0 border-r border-gray-100 flex flex-col pt-4 pb-2 bg-white">
        <p className="px-4 mb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Social Media</p>
        <nav className="flex flex-col gap-0.5 px-2">

          {/* LinkedIn */}
          <button
            onClick={() => setActiveTab('linkedin')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
              activeTab === 'linkedin' ? 'bg-blue-50 text-accent' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span>💼</span>
            <span>LinkedIn</span>
          </button>

          {/* LinkedIn sub-items */}
          {([
            { id: 'autopilot', icon: '🤖', label: 'Autopilot' },
            { id: 'history',   icon: '📋', label: 'History' },
            { id: 'templates', icon: '📚', label: 'Templates' },
          ] as { id: TabId; icon: string; label: string }[]).map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-lg text-xs font-medium text-left transition-colors ${
                activeTab === id ? 'bg-blue-50 text-accent' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}

          {/* Instagram */}
          <div className="mt-1">
            <button
              onClick={() => setActiveTab('instagram')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                instagramActive ? 'bg-pink-50 text-pink-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>📸</span>
              <span>Instagram</span>
            </button>
            <button
              onClick={() => setActiveTab('ig-history')}
              className={`flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-lg text-xs font-medium text-left transition-colors ${
                activeTab === 'ig-history' ? 'bg-pink-50 text-pink-600' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <span>📋</span>
              <span>IG History</span>
            </button>
          </div>

          {/* Twitter (coming soon) */}
          <button
            disabled
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left text-gray-300 cursor-not-allowed mt-1"
          >
            <span>🐦</span>
            <span>Twitter</span>
            <span className="ml-auto text-[10px] font-normal">Soon</span>
          </button>
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'linkedin' && (
          <LinkedInWizard
            onViewHistory={() => setActiveTab('history')}
            onManageTemplates={() => setActiveTab('templates')}
          />
        )}
        {activeTab === 'autopilot' && <LinkedInAutopilot />}
        {activeTab === 'history' && <PostHistory />}
        {activeTab === 'templates' && <LinkedInTemplates />}
        {activeTab === 'instagram' && <InstagramWizard onViewHistory={() => setActiveTab('ig-history')} />}
        {activeTab === 'ig-history' && <InstagramHistory />}
        {activeTab === 'twitter' && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">Coming soon</div>
        )}
      </div>
    </div>
  )
}

function InstagramHistory() {
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useState(() => {
    fetch('/api/instagram/history').then(r => r.json())
      .then(d => setPosts(d.posts || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  })

  const remove = async (id: string) => {
    await fetch(`/api/instagram/history/${id}`, { method: 'DELETE' })
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-2xl mx-auto space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Instagram History</h2>
      {posts.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">No posts yet</div>
      ) : posts.map(p => (
        <div key={p.id} className="border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
              p.status === 'published' ? 'bg-green-100 text-green-700' :
              p.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
              'bg-gray-100 text-gray-500'
            }`}>{p.status}</span>
            <span className="text-xs text-gray-400 ml-auto">{new Date(p.created_at).toLocaleDateString()}</span>
          </div>
          {p.image_url && <img src={p.image_url} className="w-full max-h-48 object-cover rounded-lg" />}
          <p className="text-sm text-gray-800 line-clamp-3">{p.caption}</p>
          {p.hashtags && (
            <p className="text-xs text-blue-500">
              {(typeof p.hashtags === 'string' ? JSON.parse(p.hashtags) : p.hashtags).map((h: string) => `#${h}`).join(' ')}
            </p>
          )}
          <button onClick={() => remove(p.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
        </div>
      ))}
    </div>
  )
}
