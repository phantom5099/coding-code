import { useState } from 'react'
import { useGlobalStore } from '../stores/global.store'
import { API_BASE, api } from '../lib/api'
import type { Thread } from '@shared/types'

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`)
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  const days = Math.floor(diff / 86400000)
  if (days < 7) return `${days}天`
  return `${Math.floor(days / 7)}周`
}

function getProjectThreads(threads: Record<string, Thread>, rootPath: string): Thread[] {
  const normalizedRoot = normalizeCwd(rootPath)
  return Object.values(threads)
    .filter((t) => {
      const tcwd = normalizeCwd(t.cwd)
      return tcwd.startsWith(normalizedRoot)
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export default function AgentSidebar() {
  const sidebarCollapsed = useGlobalStore((s) => s.ui.sidebarCollapsed)
  const threads = useGlobalStore((s) => s.agent.threads)
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId)
  const workspace = useGlobalStore((s) => s.workspace)
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread)
  const toggleSidebar = useGlobalStore((s) => s.toggleSidebar)

  const projectThreads = getProjectThreads(threads, workspace.rootPath)
  const [hoveredThreadId, setHoveredThreadId] = useState<string | null>(null)

  const handleDelete = async (threadId: string) => {
    await api(`/api/sessions/${threadId}`, { method: 'DELETE' }).catch((e) => { console.error('Failed to delete session:', e) })
    const store = useGlobalStore.getState()
    const rootPath = store.workspace.rootPath
    if (rootPath) {
      try {
        const sessions = await api<any[]>(`/api/sessions?cwd=${encodeURIComponent(rootPath)}`)
        const threads = sessions.map((s: any) => ({
          id: s.sessionId,
          projectId: '',
          title: s.title ?? s.sessionId.slice(0, 8),
          cwd: s.cwd ?? '',
          turns: [],
          createdAt: new Date(s.createdAt).getTime(),
          updatedAt: new Date(s.updatedAt).getTime(),
        }))
        store.loadThreads(threads)
      } catch {}
    }
    if (threadId === currentThreadId) {
      setCurrentThread(null)
    }
  }

  // Find current project name
  const currentProject = workspace.projects.find((p) => p.id === workspace.currentProjectId)
  const projectName = currentProject?.name || workspace.name

  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col items-center w-10 shrink-0 bg-[#161616] border-r border-[#222] pt-2 gap-1">
        <button type="button" onClick={toggleSidebar} title="展开侧边栏"
          className="w-7 h-7 flex items-center justify-center text-[#555] hover:text-[#ccc] hover:bg-[#252525] rounded transition-colors">
          ›
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col shrink-0 bg-[#161616] border-r border-[#222] w-64 select-none">
      {/* 顶部栏：项目名 + 收起按钮 */}
      <div className="flex items-center justify-between px-2 pt-2">
        <span className="text-[13px] font-semibold text-[#888] truncate ml-2">{projectName || '项目'}</span>
        <button type="button" onClick={toggleSidebar} title="收起侧边栏"
          className="w-7 h-7 flex items-center justify-center text-[#555] hover:text-[#ccc] hover:bg-[#252525] rounded transition-colors text-base">
          ‹
        </button>
      </div>

      {/* 新对话 */}
      <div className="px-4 pt-2 pb-2">
        <button type="button" onClick={() => setCurrentThread(null)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-[14px] text-[#bbb] hover:text-white hover:bg-[#252525] transition-colors border border-[#2a2a2a] hover:border-[#3a3a3a]">
          <span className="text-base leading-none">+</span>
          <span>新对话</span>
        </button>
      </div>

      {/* 功能导航 */}
      <nav className="px-2 pt-1 pb-3 space-y-0.5">
        <NavItem icon="🔍" label="搜索" shortcut="Ctrl+G" />
        <NavItem icon="⚡" label="自动化" />
      </nav>

      <div className="mx-3 border-t border-[#222]" />

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto py-3 min-h-0">
        <div className="px-3 pb-1.5">
          <span className="text-[11px] font-semibold text-[#444] uppercase tracking-wider">会话</span>
        </div>
        {projectThreads.slice(0, 15).map((t) => (
          <button type="button" key={t.id} onClick={() => setCurrentThread(t.id)}
            onMouseEnter={() => setHoveredThreadId(t.id)}
            onMouseLeave={() => setHoveredThreadId(null)}
            className={`w-full text-left px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors ${
              currentThreadId === t.id
                ? 'bg-[#0d2d4a] text-[#cde]'
                : 'text-[#888] hover:bg-[#1c1c1c] hover:text-[#bbb]'
            }`}>
            <span className="flex-1 text-[14px] truncate">{t.title || '未命名对话'}</span>
            {hoveredThreadId === t.id ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(t.id) }}
                className="shrink-0 p-0.5 text-[#555] hover:text-red-400 transition-colors"
                title="删除对话">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            ) : (
              <span className="text-[12px] text-[#3a3a3a] shrink-0">{relativeTime(t.updatedAt)}</span>
            )}
          </button>
        ))}
        {projectThreads.length > 15 && (
          <button type="button" className="w-full text-left px-4 py-1.5 text-[12px] text-[#3a3a3a] hover:text-[#555] transition-colors">
            +{projectThreads.length - 15} 条更多
          </button>
        )}
        {projectThreads.length === 0 && (
          <div className="px-3 py-4 text-[13px] text-[#3a3a3a]">暂无对话</div>
        )}
      </div>

      <div className="mx-3 border-t border-[#222]" />

      {/* 底部 */}
      <div className="px-2 py-2.5">
        <button type="button" onClick={() => useGlobalStore.getState().setView('settings')}
          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[#555] hover:text-[#ccc] hover:bg-[#252525] rounded-lg transition-colors">
          <span>⚙</span>
          <span>设置</span>
        </button>
      </div>
    </div>
  )
}

function NavItem({ icon, label, shortcut }: { icon: string; label: string; shortcut?: string }) {
  return (
    <button type="button"
      className="w-full flex items-center gap-2.5 px-4 py-2 rounded-lg text-[14px] text-[#666] hover:text-[#ccc] hover:bg-[#1e1e1e] transition-colors">
      <span className="w-4 text-center shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[11px] text-[#333]">{shortcut}</span>}
    </button>
  )
}
