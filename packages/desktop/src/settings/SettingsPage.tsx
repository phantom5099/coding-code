import { useState } from 'react'
import { useGlobalStore } from '../stores/global.store'
import McpPanel from './McpPanel'
import SkillPanel from './SkillPanel'

type Tab = 'mcp' | 'skills'

export default function SettingsPage() {
  const setView = useGlobalStore((s) => s.setView)
  const [tab, setTab] = useState<Tab>('mcp')

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#111] text-[#ccc]">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-[#222] shrink-0">
        <button type="button" onClick={() => setView('agent')}
          className="text-[#555] hover:text-[#ccc] transition-colors text-xl leading-none">
          ←
        </button>
        <span className="text-[16px] font-medium text-[#ddd]">设置</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 border-b border-[#222] shrink-0">
        {(['mcp', 'skills'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-4 py-2 text-[14px] rounded-t transition-colors ${
              tab === t
                ? 'text-[#ddd] border-b-2 border-[#569cd6]'
                : 'text-[#555] hover:text-[#aaa]'
            }`}>
            {t === 'mcp' ? 'MCP 服务器' : 'Skills'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'mcp' ? <McpPanel /> : <SkillPanel />}
      </div>
    </div>
  )
}
