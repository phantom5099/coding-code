import { useState } from 'react'
import { useGlobalStore } from '../stores/global.store'
import McpPanel from './McpPanel'
import SkillPanel from './SkillPanel'
import HooksPanel from './HooksPanel'
import SubagentsPanel from './SubagentsPanel'

type Section = 'mcp' | 'skills' | 'hooks' | 'agents'

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  {
    id: 'mcp',
    label: 'MCP 服务器',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="5" cy="8" r="1" fill="currentColor"/>
        <circle cx="8" cy="8" r="1" fill="currentColor"/>
        <circle cx="11" cy="8" r="1" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2L9.5 6H14L10.5 8.5L12 13L8 10.5L4 13L5.5 8.5L2 6H6.5L8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'hooks',
    label: '钩子',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2V9M8 9C8 11.2 6.5 13 4.5 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <path d="M4.5 11C4.5 11 3 11.5 3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    id: 'agents',
    label: '子智能体',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M3 13.5C3 11 5.2 9.5 8 9.5C10.8 9.5 13 11 13 13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <circle cx="3.5" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
        <circle cx="12.5" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
      </svg>
    ),
  },
]

export default function SettingsPage() {
  const setView = useGlobalStore((s) => s.setView)
  const [section, setSection] = useState<Section>('mcp')

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#111] text-[#ccc] pl-3">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-[#222] shrink-0">
        <button type="button" onClick={() => setView('agent')}
          className="text-[#555] hover:text-[#ccc] transition-colors text-xl leading-none">
          ←
        </button>
        <span className="text-[16px] font-medium text-[#ddd]">设置</span>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <nav className="w-[160px] shrink-0 border-r border-[#222] py-3 flex flex-col gap-0.5 overflow-y-auto select-none">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors w-full text-left rounded-none ${
                section === item.id
                  ? 'bg-[#1e1e1e] text-[#ddd]'
                  : 'text-[#666] hover:text-[#aaa] hover:bg-[#161616]'
              }`}
            >
              <span className={section === item.id ? 'text-[#569cd6]' : 'text-[#555]'}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0 overflow-y-auto select-text">
          {section === 'mcp' && <McpPanel />}
          {section === 'skills' && <SkillPanel />}
          {section === 'hooks' && <HooksPanel />}
          {section === 'agents' && <SubagentsPanel />}
        </div>
      </div>
    </div>
  )
}
