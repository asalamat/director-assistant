import { useState } from 'react'
import { LinkedInWizard } from './LinkedInWizard'
import { PostHistory } from './PostHistory'
import { LinkedInTemplates } from './LinkedInTemplates'
import { LinkedInAutopilot } from './LinkedInAutopilot'

type TabId = 'linkedin' | 'autopilot' | 'instagram' | 'twitter' | 'history' | 'templates'

export function SocialPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('linkedin')
  const linkedInActive = activeTab === 'linkedin' || activeTab === 'autopilot' || activeTab === 'history' || activeTab === 'templates'

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="w-44 flex-shrink-0 border-r border-gray-100 flex flex-col pt-4 pb-2 bg-white">
        <p className="px-4 mb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Social Media</p>
        <nav className="flex flex-col gap-0.5 px-2">

          {/* LinkedIn + sub-items */}
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

          <div className="mt-2 border-t border-gray-100 pt-2 flex flex-col gap-0.5">
            <button
              disabled
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left text-gray-300 cursor-not-allowed"
            >
              <span>📸</span>
              <span>Instagram</span>
              <span className="ml-auto text-[10px] font-normal">Soon</span>
            </button>
            <button
              disabled
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left text-gray-300 cursor-not-allowed"
            >
              <span>🐦</span>
              <span>Twitter</span>
              <span className="ml-auto text-[10px] font-normal">Soon</span>
            </button>
          </div>
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
        {(activeTab === 'instagram' || activeTab === 'twitter') && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Coming soon
          </div>
        )}
      </div>
    </div>
  )
}
