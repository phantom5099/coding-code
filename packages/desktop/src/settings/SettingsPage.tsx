import { useState } from 'react';
import { ArrowLeft, Server, Star, Link2, Users, Brain, Moon, Sun, BookOpen } from 'lucide-react';
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

const THEMES = [
  { id: 'dark' as const, label: '深色', icon: <Moon size={16} strokeWidth={1.5} /> },
  { id: 'light' as const, label: '浅色', icon: <Sun size={16} strokeWidth={1.5} /> },
  { id: 'paper' as const, label: '纸黄', icon: <BookOpen size={16} strokeWidth={1.5} /> },
];

export default function SettingsPage() {
  const setView = useGlobalStore((s) => s.setView);
  const [section, setSection] = useState<Section>('mcp');
  const theme = useGlobalStore((s) => s.ui.theme);
  const setTheme = useGlobalStore((s) => s.setTheme);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--bg-panel)] text-[var(--text-primary)] pl-3">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-[var(--border-default)] shrink-0">
        <button
          type="button"
          onClick={() => setView('agent')}
          className="text-[var(--text-placeholder)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={20} strokeWidth={1.5} />
        </button>
        <span className="text-[16px] font-medium text-[var(--text-title)]">设置</span>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <nav className="w-[160px] shrink-0 border-r border-[var(--border-default)] py-3 flex flex-col gap-0.5 overflow-y-auto select-none">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors w-full text-left rounded-none ${
                section === item.id
                  ? 'bg-[var(--bg-base)] text-[var(--text-title)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-sidebar)]'
              }`}
            >
              <span className={section === item.id ? 'text-[var(--accent-primary)]' : 'text-[var(--text-placeholder)]'}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}

          {/* Theme Switcher */}
          <div className="mt-auto pt-4 pb-2 px-4 border-t border-[var(--border-default)]">
            <div className="text-[11px] font-medium text-[var(--text-disabled)] uppercase tracking-wider mb-2">
              主题
            </div>
            <div className="flex flex-col gap-0.5">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  className={`flex items-center gap-2 px-3 py-2 text-[12px] rounded transition-colors ${
                    theme === t.id
                      ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>
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
