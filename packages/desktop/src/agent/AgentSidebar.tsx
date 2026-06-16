import { useState, useMemo } from 'react';
import { Plus, Search, Zap, Settings } from 'lucide-react';
import { useUIStore } from '../stores/ui.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useAgentStore } from '../stores/agent.store';
import { api } from '../lib/api';

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  const days = Math.floor(diff / 86400000);
  if (days < 7) return `${days}天`;
  return `${Math.floor(days / 7)}周`;
}

export default function AgentSidebar() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const workspace = useWorkspaceStore();
  const setCurrentThread = useAgentStore((s) => s.setCurrentThread);
  const setView = useUIStore((s) => s.setView);

  // Subscribe to raw threads, derive list with useMemo for stable reference
  const rawThreads = useAgentStore((s) => s.threads);
  const threadList = useMemo(() => {
    const normalizedRoot = normalizeCwd(rootPath);
    return Object.values(rawThreads)
      .filter((t) => normalizeCwd(t.cwd).startsWith(normalizedRoot))
      .map((t) => ({ id: t.id, title: t.title, cwd: t.cwd, updatedAt: t.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [rawThreads, rootPath]);

  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);

  const handleDelete = async (threadId: string) => {
    await api(`/api/sessions/${threadId}`, { method: 'DELETE' }).catch((e) => {
      console.error('Failed to delete session:', e);
    });
    const rootPath = useWorkspaceStore.getState().rootPath;
    if (rootPath) {
      try {
        const sessions = await api<any[]>(`/api/sessions?cwd=${encodeURIComponent(rootPath)}`);
        const threads = sessions.map((s: any) => ({
          id: s.sessionId,
          projectId: '',
          title: s.title ?? s.sessionId.slice(0, 8),
          cwd: s.cwd ?? '',
          turns: [],
          createdAt: new Date(s.createdAt).getTime(),
          updatedAt: new Date(s.updatedAt).getTime(),
        }));
        useAgentStore.getState().loadThreads(threads);
      } catch {}
    }
    if (threadId === currentThreadId) {
      setCurrentThread(null);
    }
  };

  // Find current project name
  const currentProject = workspace.projects.find((p) => p.id === workspace.currentProjectId);
  const projectName = currentProject?.name || workspace.name;

  if (sidebarCollapsed) {
    return null;
  }

  return (
    <div className="flex flex-col shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border-default)] w-64 select-none">
      {/* 顶部栏：项目名 + 项目级设置按钮 */}
      <div className="flex items-center justify-between px-2 pt-2">
        <span className="text-[13px] font-semibold text-[var(--text-tertiary)] truncate ml-2">
          {projectName || '项目'}
        </span>
        <button
          type="button"
          onClick={() => setView('project-settings')}
          title="项目设置"
          className="w-7 h-7 flex items-center justify-center text-[var(--text-placeholder)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
        >
          <Settings size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* 新对话 */}
      <div className="px-4 pt-2 pb-2">
        <button
          type="button"
          onClick={() => setCurrentThread(null)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-[14px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-card)] hover:border-[var(--border-hover)]"
        >
          <Plus size={16} strokeWidth={1.5} />
          <span>新对话</span>
        </button>
      </div>

      {/* 功能导航 */}
      <nav className="px-2 pt-1 pb-3 space-y-0.5">
        <NavItem icon={<Search size={16} strokeWidth={1.5} />} label="搜索" shortcut="Ctrl+G" />
        <NavItem
          icon={<Zap size={16} strokeWidth={1.5} />}
          label="自动化"
          onClick={() => setView('automation')}
        />
      </nav>

      <div className="mx-3 border-t border-[var(--border-default)]" />

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto py-3 min-h-0">
        <div className="px-3 pb-1.5">
          <span className="text-[11px] font-semibold text-[var(--text-disabled)] uppercase tracking-wider">
            会话
          </span>
        </div>
        {threadList.slice(0, 15).map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setCurrentThread(t.id)}
            onMouseEnter={() => setHoveredThreadId(t.id)}
            onMouseLeave={() => setHoveredThreadId(null)}
            className={`w-full text-left px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors ${
              currentThreadId === t.id
                ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <span className="flex-1 text-[14px] truncate">{t.title || '未命名对话'}</span>
            {hoveredThreadId === t.id ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(t.id);
                }}
                className="shrink-0 p-0.5 text-[var(--text-placeholder)] hover:text-red-400 transition-colors"
                title="删除对话"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            ) : (
              <span className="text-[12px] text-[var(--text-disabled)] shrink-0">
                {relativeTime(t.updatedAt)}
              </span>
            )}
          </button>
        ))}
        {threadList.length > 15 && (
          <button
            type="button"
            className="w-full text-left px-4 py-1.5 text-[12px] text-[var(--text-disabled)] hover:text-[var(--text-placeholder)] transition-colors"
          >
            +{threadList.length - 15} 条更多
          </button>
        )}
        {threadList.length === 0 && (
          <div className="px-3 py-4 text-[13px] text-[var(--text-disabled)]">暂无对话</div>
        )}
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 rounded-lg text-[14px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-base)] transition-colors"
    >
      <span className="w-4 flex items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[11px] text-[var(--text-disabled)]">{shortcut}</span>}
    </button>
  );
}
