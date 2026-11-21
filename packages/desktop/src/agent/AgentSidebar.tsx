import { useState, useMemo } from 'react';
import { ChevronDown, FolderOpen, Plus, Settings, Trash2 } from 'lucide-react';
import { useUIStore } from '../stores/ui.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import { useAgentStore } from '../stores/agent.store';
import { useAgentRollback } from '../hooks/useAgent';

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
  const setView = useUIStore((s) => s.setView);
  const setCurrentThread = useAgentStore((s) => s.setCurrentThread);
  const switchProject = useWorkspaceStore((s) => s.switchProject);
  const addProject = useWorkspaceStore((s) => s.addProject);
  const { deleteThread } = useAgentRollback();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null);

  const rawThreads = useAgentStore((s) => s.threads);
  const threadList = useMemo(() => {
    const normalizedRoot = normalizeCwd(rootPath);
    return Object.values(rawThreads)
      .filter((t) => normalizeCwd(t.cwd).startsWith(normalizedRoot))
      .map((t) => ({ id: t.id, title: t.title, cwd: t.cwd, updatedAt: t.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [rawThreads, rootPath]);

  const currentProject = workspace.projects.find((p) => p.id === workspace.currentProjectId);
  const projectName = currentProject?.name || workspace.name || '项目';

  const handleAddProject = async () => {
    const folder = await window.electronAPI?.openFolderDialog?.();
    if (!folder) return;
    const name = folder.replace(/\\/g, '/').split('/').pop() || folder;
    const project = { id: crypto.randomUUID(), name, rootPath: folder };
    addProject(project);
    switchProject(project.id);
    setProjectMenuOpen(false);
  };

  if (sidebarCollapsed) return null;

  return (
    <aside className="cc-agent-sidebar-shell flex w-[296px] shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--bg-sidebar)] select-none">
      <div className="cc-sidebar-header px-4 pb-3 pt-4">
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => setProjectMenuOpen((open) => !open)}
            className="cc-project-switcher flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-[var(--bg-hover)]"
            aria-expanded={projectMenuOpen}
          >
            <span className="cc-project-mark"><FolderOpen size={15} strokeWidth={1.8} /></span>
            <span className="truncate text-[15px] font-semibold text-[var(--text-title)]">{projectName}</span>
            <ChevronDown size={15} className="ml-auto shrink-0 text-[var(--text-muted)]" />
          </button>
          <button
            type="button"
            onClick={() => setView('project-settings')}
            title="项目设置"
            className="cc-sidebar-icon-button"
          >
            <Settings size={16} strokeWidth={1.6} />
          </button>
          {projectMenuOpen && (
            <div className="cc-project-menu absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-1.5 shadow-2xl">
              <div className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">工作区</div>
              {workspace.projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    switchProject(project.id);
                    setProjectMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                    project.id === workspace.currentProjectId
                      ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <FolderOpen size={14} />
                  <span className="truncate">{project.name}</span>
                </button>
              ))}
              <button type="button" onClick={handleAddProject} className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                <Plus size={14} /> 添加工作区
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCurrentThread(null)}
          className="cc-new-chat-button mt-3 flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[14px] font-medium text-[var(--text-primary)]"
        >
          <Plus size={17} strokeWidth={1.8} />
          <span>新对话</span>
        </button>
      </div>

      <div className="mx-4 border-t border-[var(--border-divider)]" />
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3 ${
          threadList.length === 0 ? 'items-center justify-center' : ''
        }`}
      >
        {threadList.slice(0, 20).map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setCurrentThread(t.id)}
            onMouseEnter={() => setHoveredThreadId(t.id)}
            onMouseLeave={() => setHoveredThreadId(null)}
            className={`cc-thread-row group flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left ${
              currentThreadId === t.id ? 'cc-thread-row-active' : ''
            }`}
          >
            <span className="cc-thread-dot" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{t.title || '未命名对话'}</span>
            {hoveredThreadId === t.id ? (
              <button
                type="button"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteThread(t.id);
                }}
                className="cc-thread-delete text-[var(--text-muted)] hover:text-[var(--accent-danger)]"
                title="删除对话"
              >
                <Trash2 size={14} strokeWidth={1.7} />
              </button>
            ) : (
              <span className="shrink-0 text-[11px] text-[var(--text-disabled)]">{relativeTime(t.updatedAt)}</span>
            )}
          </button>
        ))}
        {threadList.length === 0 && <div className="px-2.5 py-5 text-center text-[13px] text-[var(--text-disabled)]">暂无对话</div>}
      </div>
    </aside>
  );
}
