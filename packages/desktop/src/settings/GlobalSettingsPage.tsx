import { ArrowLeft } from 'lucide-react';
import { useGlobalStore } from '../stores/global.store';
import { useState } from 'react';
import McpPanel from './McpPanel';
import HooksPanel from './HooksPanel';
import SubagentsPanel from './SubagentsPanel';
import SkillPanel from './SkillPanel';

type Section = 'theme' | 'mcp' | 'hooks' | 'agents' | 'skills';

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: 'theme', label: '主题' },
  { id: 'mcp', label: 'MCP 服务器' },
  { id: 'hooks', label: '钩子' },
  { id: 'agents', label: '子智能体' },
  { id: 'skills', label: 'Skills' },
];

const THEMES = [
  { id: 'dark' as const, label: '深色' },
  { id: 'light' as const, label: '浅色' },
  { id: 'paper' as const, label: '纸黄' },
];

export default function GlobalSettingsPage() {
  const setView = useGlobalStore((s) => s.setView);
  const [section, setSection] = useState<Section>('theme');
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
        <span className="text-[16px] font-medium text-[var(--text-title)]">全局设置</span>
      </div>

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
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0 overflow-y-auto select-text">
          {section === 'theme' && (
            <div className="px-6 py-5">
              <div className="text-[14px] text-[var(--text-title)] mb-3">主题</div>
              <div className="flex flex-col gap-2">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] transition-colors ${
                      theme === t.id
                        ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)] border border-[var(--accent-primary)]/30'
                        : 'bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border-card)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {section === 'mcp' && <McpPanel global />}
          {section === 'hooks' && <HooksPanel global />}
          {section === 'agents' && <SubagentsPanel global />}
          {section === 'skills' && <SkillPanel global />}
        </div>
      </div>
    </div>
  );
}
