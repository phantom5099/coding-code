import { useState } from 'react';
import { ArrowLeft, Server, Star, Link2, Users, Brain } from 'lucide-react';
import { useGlobalStore } from '../stores/global.store';
import McpPanel from './McpPanel';
import SkillPanel from './SkillPanel';
import HooksPanel from './HooksPanel';
import SubagentsPanel from './SubagentsPanel';
import MemoryPanel from './MemoryPanel';

type Section = 'mcp' | 'skills' | 'hooks' | 'agents' | 'memory';

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  {
    id: 'mcp',
    label: 'MCP 服务器',
    icon: <Server size={16} strokeWidth={1.5} />,
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: <Star size={16} strokeWidth={1.5} />,
  },
  {
    id: 'hooks',
    label: '钩子',
    icon: <Link2 size={16} strokeWidth={1.5} />,
  },
  {
    id: 'agents',
    label: '子智能体',
    icon: <Users size={16} strokeWidth={1.5} />,
  },
  {
    id: 'memory',
    label: '记忆模式',
    icon: <Brain size={16} strokeWidth={1.5} />,
  },
];

export default function SettingsPage() {
  const setView = useGlobalStore((s) => s.setView);
  const [section, setSection] = useState<Section>('mcp');

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#111] text-[#ccc] pl-3">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-[#222] shrink-0">
        <button
          type="button"
          onClick={() => setView('agent')}
          className="text-[#555] hover:text-[#ccc] transition-colors"
        >
          <ArrowLeft size={20} strokeWidth={1.5} />
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
          {section === 'memory' && <MemoryPanel />}
        </div>
      </div>
    </div>
  );
}
