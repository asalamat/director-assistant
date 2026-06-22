import { useState } from 'react'
import { LinkedInWizard } from './LinkedInWizard'
import { PostHistory } from './PostHistory'
import { LinkedInTemplates } from './LinkedInTemplates'

type TabId = 'linkedin' | 'instagram' | 'twitter' | 'history' | 'templates'

const TABS: { id: TabId; icon: string; label: string; disabled?: boolean }[] = [
  { id: 'linkedin', icon: '💼', label: 'LinkedIn' },
  { id: 'instagram', icon: '📸', label: 'Instagram', disabled: true },
  { id: 'twitter', icon: '🐦', label: 'Twitter', disabled: true },
]

export function SocialPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('linkedin')

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar */}
      <div className="w-44 flex-shrink-0 border-r border-gray-100 flex flex-col pt-4 pb-2 bg-white">
        <p className="px-4 mb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Social Media</p>
        <nav className="flex flex-col gap-0.5 px-2">
          {TABS.map(tab => (
            <button
              key={tab.id}
              disabled={tab.disabled}
              onClick={() => { if (!tab.disabled) setActiveTab(tab.id) }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                tab.disabled
                  ? 'text-gray-300 cursor-not-allowed'
                  : activeTab === tab.id
                  ? 'bg-blue-50 text-accent'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.disabled && (
                <span className="ml-auto text-[10px] text-gray-300 font-normal">Soon</span>
              )}
            </button>
          ))}

          <div className="mt-2 border-t border-gray-100 pt-2 flex flex-col gap-0.5">
            <button
              onClick={() => setActiveTab('history')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                activeTab === 'history' ? 'bg-blue-50 text-accent' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>📋</span>
              <span>History</span>
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                activeTab === 'templates' ? 'bg-blue-50 text-accent' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>📚</span>
              <span>Templates</span>
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
