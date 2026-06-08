import { useState, useMemo } from 'react';
import { Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGlobalStore } from '../stores/global.store';
import { API_BASE, api } from '../lib/api';
import type { Project, Thread } from '@shared/types';

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`);
}

const PROJECT_COLORS = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-cyan-600',
  'bg-fuchsia-600',
  'bg-lime-600',
];

function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]!;
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

interface SessionListPopupProps {
  project: Project;
  threads: Thread[];
  currentThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeleteThread: (threadId: string) => void;
}

function SessionListPopup({
  project,
  threads,
  currentThreadId,
  onSelectThread,
  onDeleteThread,
}: SessionListPopupProps) {
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  return (
    <div className="absolute left-full top-0 ml-1 w-60 bg-[var(--bg-card)] border border-[var(--border-card)] rounded-lg shadow-2xl z-50">
      <div className="px-3 py-2 border-b border-[var(--border-card)]">
        <span className="text-[12px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          {project.name}
        </span>
      </div>
      <div className="max-h-80 overflow-y-auto py-1">
        {sorted.slice(0, 12).map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => onSelectThread(t.id)}
            onMouseEnter={() => setHoveredId(t.id)}
            onMouseLeave={() => setHoveredId(null)}
            className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
              currentThreadId === t.id
                ? 'bg-[var(--bg-selected)] text-[var(--accent-primary)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span className="flex-1 text-[13px] truncate">{t.title || '未命名对话'}</span>
            {hoveredId === t.id ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteThread(t.id);
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
              <span className="text-[11px] text-[var(--text-disabled)] shrink-0">
                {relativeTime(t.updatedAt)}
              </span>
            )}
          </button>
        ))}
        {sorted.length === 0 && (
          <div className="px-3 py-3 text-[13px] text-[var(--text-disabled)]">暂无对话</div>
        )}
        {sorted.length > 12 && (
          <div className="px-3 py-1 text-[12px] text-[var(--text-disabled)]">
            +{sorted.length - 12} 条更多
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectStrip() {
  const projects = useGlobalStore((s) => s.workspace.projects);
  const currentProjectId = useGlobalStore((s) => s.workspace.currentProjectId);
  const rawThreads = useGlobalStore((s) => s.agent.threads);
  const threadMetadata = useMemo(() => {
    return Object.values(rawThreads).map((t) => ({
      id: t.id,
      title: t.title,
      cwd: t.cwd,
      updatedAt: t.updatedAt,
    }));
  }, [rawThreads]);
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId);
  const sidebarCollapsed = useGlobalStore((s) => s.ui.sidebarCollapsed);
  const switchProject = useGlobalStore((s) => s.switchProject);
  const addProject = useGlobalStore((s) => s.addProject);
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread);
  const setView = useGlobalStore((s) => s.setView);
  const toggleSidebar = useGlobalStore((s) => s.toggleSidebar);

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleDelete = async (threadId: string) => {
    await api(`/api/sessions/${threadId}`, { method: 'DELETE' }).catch((e) => {
      console.error('Failed to delete session:', e);
    });
    const store = useGlobalStore.getState();
    const rootPath = store.workspace.rootPath;
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
        store.loadThreads(threads);
      } catch {}
    }
    if (threadId === currentThreadId) {
      setCurrentThread(null);
    }
  };

  const handleSelectProject = (id: string) => {
    switchProject(id);
  };

  const handleAddProject = async () => {
    const folder = await window.electronAPI?.openFolderDialog?.();
    if (!folder) return;
    const name = folder.replace(/\\/g, '/').split('/').pop() || folder;
    const project: Project = { id: crypto.randomUUID(), name, rootPath: folder };
    addProject(project);
    switchProject(project.id);
  };

  const getThreadsForProject = (rootPath: string): Thread[] => {
    const normalizedRoot = normalizeCwd(rootPath);
    return threadMetadata.filter((t) => {
      const tcwd = normalizeCwd(t.cwd);
      return tcwd.startsWith(normalizedRoot);
    }) as Thread[];
  };

  return (
    <div className="flex flex-col items-center w-12 shrink-0 bg-[var(--bg-panel)] border-r border-[var(--border-default)] pt-3 pb-2 gap-4 select-none">
      {projects.map((p) => {
        const isActive = p.id === currentProjectId;
        const colorClass = colorForId(p.id);
        return (
          <div
            key={p.id}
            className="relative"
            onMouseEnter={() => (sidebarCollapsed ? setHoveredId(p.id) : null)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <button
              type="button"
              onClick={() => handleSelectProject(p.id)}
              title={p.name}
              className={`w-9 h-9 rounded-lg flex items-center justify-center text-[15px] font-semibold text-[var(--text-white)] transition-all shrink-0
                ${colorClass} ${isActive ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-[var(--bg-panel)]' : 'opacity-70 hover:opacity-100'}`}
            >
              {p.name.charAt(0).toUpperCase()}
            </button>
            {sidebarCollapsed && hoveredId === p.id && (
              <SessionListPopup
                project={p}
                threads={getThreadsForProject(p.rootPath)}
                currentThreadId={currentThreadId}
                onSelectThread={(tid) => {
                  setCurrentThread(tid);
                  setHoveredId(null);
                }}
                onDeleteThread={handleDelete}
              />
            )}
          </div>
        );
      })}

      {/* Divider before add button */}
      {projects.length > 0 && <div className="w-6 border-t border-[var(--border-card)] my-1" />}

      <button
        type="button"
        onClick={handleAddProject}
        title="添加项目"
        className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-placeholder)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors text-lg shrink-0"
      >
        +
      </button>

      {/* Spacer to push settings and collapse to bottom */}
      <div className="flex-1" />

      {/* Global settings button */}
      <button
        type="button"
        onClick={() => setView('global-settings')}
        title="全局设置"
        className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-placeholder)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
      >
        <Settings size={18} strokeWidth={1.5} />
      </button>

      {/* Collapse/expand sidebar button */}
      <button
        type="button"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-placeholder)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
      >
        {sidebarCollapsed ? (
          <ChevronRight size={16} strokeWidth={1.5} />
        ) : (
          <ChevronLeft size={16} strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}
