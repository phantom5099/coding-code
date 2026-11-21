import { useState } from 'react';
import { useWorkspaceStore } from '../stores/workspace.store';
import McpPanel from './McpPanel';
import HooksPanel from './HooksPanel';
import SkillPanel from './SkillPanel';
import MemoryPanel from './MemoryPanel';

type Section = 'mcp' | 'hooks' | 'skills' | 'memory';

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: 'mcp', label: 'MCP 服务器' },
  { id: 'hooks', label: '钩子' },
  { id: 'skills', label: 'Skills' },
  { id: 'memory', label: '记忆模式' },
];

export default function ProjectSettingsPage() {
  const [section, setSection] = useState<Section>('mcp');
  const workspace = useWorkspaceStore();
  const projectName = workspace.name || workspace.projects.find((p) => p.id === workspace.currentProjectId)?.name || '项目';

  return (
    <div className="cc-settings-shell flex flex-col flex-1 min-h-0 bg-[var(--bg-panel)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="flex items-center px-6 py-4 border-b border-[var(--border-default)] shrink-0">
        <span className="text-[16px] font-medium text-[var(--text-title)]">项目设置 · {projectName}</span>
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
          {section === 'mcp' && <McpPanel />}
          {section === 'hooks' && <HooksPanel />}
          {section === 'skills' && <SkillPanel />}
          {section === 'memory' && <MemoryPanel />}
        </div>
      </div>
    </div>
  );
}
