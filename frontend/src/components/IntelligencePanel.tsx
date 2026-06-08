import { useState } from 'react'
import type { Cluster } from '../types'
import { WeeklyBriefPanel } from './WeeklyBriefPanel'
import { ChaseQueue } from './ChaseQueue'
import { Analytics } from './Analytics'
import { TemplatesPanel } from './TemplatesPanel'
import { ProjectsPanel } from './ProjectsPanel'
import { PSTImport } from './PSTImport'
import { BriefingTab, PeopleTab, LoopsTab, ProjectsTab, TimelineTab } from './IntelligenceTabs'

type SubTab = 'briefing' | 'people' | 'loops' | 'ai-projects' | 'timeline' | 'weekly' | 'chase' | 'analytics' | 'templates' | 'projects' | 'pst'

const SUB_TABS: { id: SubTab; label: string; icon: string; group?: string }[] = [
  // Intelligence
  { id: 'briefing',    label: 'Briefing',    icon: '🧭', group: 'intel' },
  { id: 'people',      label: 'People',      icon: '👥', group: 'intel' },
  { id: 'loops',       label: 'Open Loops',  icon: '🔄', group: 'intel' },
  { id: 'ai-projects', label: 'AI Clusters', icon: '🗂', group: 'intel' },
  { id: 'timeline',    label: 'Timeline',    icon: '📅', group: 'intel' },
  // Tools
  { id: 'weekly',      label: 'Weekly Brief', icon: '📊', group: 'tools' },
  { id: 'chase',       label: 'Chase Queue',  icon: '⏰', group: 'tools' },
  { id: 'projects',    label: 'Projects',     icon: '📁', group: 'tools' },
  { id: 'analytics',   label: 'Analytics',    icon: '📈', group: 'tools' },
  { id: 'templates',   label: 'Templates',    icon: '✉',  group: 'tools' },
  { id: 'pst',         label: 'Import PST',   icon: '📦', group: 'tools' },
]

export function IntelligencePanel() {
  const [activeTab, setActiveTab] = useState<SubTab>('briefing')
  const [timelineQuery, setTimelineQuery] = useState('')

  const handleSelectCluster = (cluster: Cluster) => {
    setTimelineQuery(cluster.keywords?.[0] || cluster.name)
    setActiveTab('timeline')
  }

  const intelTabs = SUB_TABS.filter(t => t.group === 'intel')
  const toolTabs  = SUB_TABS.filter(t => t.group === 'tools')

  const NavItem = ({ tab }: { tab: typeof SUB_TABS[0] }) => {
    const isActive = activeTab === tab.id
    return (
      <button
        onClick={() => setActiveTab(tab.id as SubTab)}
        title={tab.label}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 group relative ${
          isActive
            ? 'bg-accent-50 text-accent-600 font-semibold shadow-sm'
            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
        }`}
      >
        {isActive && (
          <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full bg-accent-500" />
        )}
        <span className="text-base leading-none flex-shrink-0">{tab.icon}</span>
        <span className="text-xs font-medium truncate">{tab.label}</span>
      </button>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left mini-sidebar */}
      <div className="w-36 flex-shrink-0 bg-gray-50 border-r border-gray-100 flex flex-col py-2 px-1.5 overflow-y-auto">
        {/* Intelligence group */}
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-300 px-2 mb-1 mt-1">Intelligence</p>
        {intelTabs.map(tab => <NavItem key={tab.id} tab={tab} />)}

        {/* Divider */}
        <div className="mx-2 my-2 border-t border-gray-200" />

        {/* Tools group */}
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-300 px-2 mb-1">Tools</p>
        {toolTabs.map(tab => <NavItem key={tab.id} tab={tab} />)}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === 'briefing'    && <div className="h-full overflow-y-auto min-h-0"><BriefingTab /></div>}
        {activeTab === 'people'      && <PeopleTab />}
        {activeTab === 'loops'       && <LoopsTab />}
        {activeTab === 'ai-projects' && <ProjectsTab onSelectCluster={handleSelectCluster} />}
        {activeTab === 'timeline'    && <TimelineTab initialQuery={timelineQuery} />}
        {activeTab === 'weekly'      && <WeeklyBriefPanel />}
        {activeTab === 'chase'       && <ChaseQueue />}
        {activeTab === 'projects'    && <ProjectsPanel />}
        {activeTab === 'analytics'   && <Analytics />}
        {activeTab === 'templates'   && <TemplatesPanel />}
        {activeTab === 'pst'         && <PSTImport />}
      </div>
    </div>
  )
}
