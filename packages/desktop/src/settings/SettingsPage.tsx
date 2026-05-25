import { useState } from 'react'
import { useGlobalStore } from '../stores/global.store'
import McpPanel from './McpPanel'
import SkillPanel from './SkillPanel'

type Tab = 'mcp' | 'skills'

export default function SettingsPage() {
  const setView = useGlobalStore((s) => s.setView)
  const [tab, setTab] = useState<Tab>('mcp')

  return (
    <div className="flex flex-col h-full bg-[#111] text-[#ccc]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2a2a] shrink-0">
        <button
          type="button"
          onClick={() => setView('agent')}
          className="text-[#555] hover:text-[#ccc] transition-colors text-lg leading-none"
          title="返回"
        >
          ←
        </button>
        <span className="text-sm font-medium text-[#ddd]">设置</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-0 border-b border-[#2a2a2a] shrink-0">
        {(['mcp', 'skills'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              tab === t
                ? 'text-[#ddd] border-b-2 border-[#569cd6]'
                : 'text-[#555] hover:text-[#aaa]'
            }`}
          >
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
