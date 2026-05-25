import { useState } from 'react'
import { useGlobalStore } from '../stores/global.store'
import type { Thread } from '@shared/types'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  const days = Math.floor(diff / 86400000)
  if (days < 7) return `${days}天`
  return `${Math.floor(days / 7)}周`
}

interface ProjectGroup {
  name: string
  cwd: string
  threads: Thread[]
}

function groupByProject(threads: Thread[], workspaceName: string, workspaceCwd: string): ProjectGroup[] {
  const map = new Map<string, Thread[]>()
  for (const t of threads) {
    const key = t.cwd || workspaceCwd || ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }
  const groups: ProjectGroup[] = []
  for (const [cwd, cwdThreads] of map) {
    const name = cwd === workspaceCwd
      ? workspaceName || cwd.split(/[\\/]/).pop() || cwd
      : cwd.split(/[\\/]/).pop() || cwd
    groups.push({ name, cwd, threads: cwdThreads.sort((a, b) => b.updatedAt - a.updatedAt) })
  }
  if (workspaceCwd && !map.has(workspaceCwd)) {
    groups.unshift({ name: workspaceName || workspaceCwd.split(/[\\/]/).pop() || '当前项目', cwd: workspaceCwd, threads: [] })
  }
  return groups.sort((a) => (a.cwd === workspaceCwd ? -1 : 1))
}

export default function AgentSidebar() {
  const sidebarCollapsed = useGlobalStore((s) => s.ui.sidebarCollapsed)
  const threads = useGlobalStore((s) => s.agent.threads)
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId)
  const workspace = useGlobalStore((s) => s.workspace)
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread)
  const toggleSidebar = useGlobalStore((s) => s.toggleSidebar)

  const allThreads = Object.values(threads).sort((a: Thread, b: Thread) => b.updatedAt - a.updatedAt)
  const groups = groupByProject(allThreads, workspace.name, workspace.rootPath)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set([workspace.rootPath]))

  const toggleProject = (cwd: string) =>
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      next.has(cwd) ? next.delete(cwd) : next.add(cwd)
      return next
    })

  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col items-center w-10 shrink-0 bg-[#161616] border-r border-[#2a2a2a] pt-2 gap-1">
        <button type="button" onClick={toggleSidebar} title="展开侧边栏"
          className="w-7 h-7 flex items-center justify-center text-[#666] hover:text-[#ccc] hover:bg-[#2a2a2a] rounded transition-colors">
          ›
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col shrink-0 bg-[#161616] border-r border-[#2a2a2a] w-56">
      {/* 新对话 */}
      <div className="px-3 pt-3 pb-2">
        <button type="button" onClick={() => setCurrentThread(null)}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-[#bbb] hover:text-white hover:bg-[#2a2a2a] transition-colors border border-[#2d2d2d] hover:border-[#3c3c3c]">
          <span className="text-base leading-none">+</span>
          <span>新对话</span>
        </button>
      </div>

      {/* 功能导航 */}
      <nav className="px-2 pb-2 space-y-0.5">
        <NavItem icon="🔍" label="搜索" shortcut="Ctrl+G" />
        <NavItem icon="🔌" label="插件" />
        <NavItem icon="⚡" label="自动化" />
      </nav>

      <div className="mx-3 border-t border-[#2a2a2a]" />

      {/* 项目列表 */}
      <div className="flex-1 overflow-y-auto py-2 min-h-0">
        <div className="px-3 pb-1">
          <span className="text-[10px] font-semibold text-[#4a4a4a] uppercase tracking-wider">项目</span>
        </div>
        {groups.map((group) => (
          <ProjectSection
            key={group.cwd}
            group={group}
            expanded={expandedProjects.has(group.cwd)}
            onToggle={() => toggleProject(group.cwd)}
            currentThreadId={currentThreadId}
            onSelectThread={setCurrentThread}
          />
        ))}
        {groups.length === 0 && (
          <div className="px-3 py-3 text-xs text-[#444]">暂无项目</div>
        )}
      </div>

      <div className="mx-3 border-t border-[#2a2a2a]" />

      {/* 底部 */}
      <div className="px-2 py-2 flex items-center gap-1">
        <button type="button" className="flex items-center gap-2 px-2 py-1.5 text-xs text-[#666] hover:text-[#ccc] hover:bg-[#2a2a2a] rounded flex-1 transition-colors">
          <span>⚙</span> 设置
        </button>
        <button type="button" className="px-2 py-1 text-[10px] bg-[#1a3a5c] hover:bg-[#1e4d7a] text-[#569cd6] rounded transition-colors font-medium">
          升级
        </button>
      </div>
    </div>
  )
}

function NavItem({ icon, label, shortcut }: { icon: string; label: string; shortcut?: string }) {
  return (
    <button type="button"
      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-[#777] hover:text-[#ccc] hover:bg-[#1e1e1e] transition-colors">
      <span className="w-4 text-center shrink-0 text-sm">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] text-[#3c3c3c]">{shortcut}</span>}
    </button>
  )
}

function ProjectSection({ group, expanded, onToggle, currentThreadId, onSelectThread }: {
  group: ProjectGroup
  expanded: boolean
  onToggle: () => void
  currentThreadId: string | null
  onSelectThread: (id: string | null) => void
}) {
  return (
    <div>
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#888] hover:text-[#ccc] hover:bg-[#1a1a1a] transition-colors">
        <span className={`text-[9px] transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span className="shrink-0">📁</span>
        <span className="flex-1 text-left truncate font-medium">{group.name}</span>
      </button>
      {expanded && (
        <div className="ml-5 mr-1">
          {group.threads.slice(0, 8).map((t) => (
            <button type="button" key={t.id} onClick={() => onSelectThread(t.id)}
              className={`w-full text-left px-3 py-1.5 rounded flex flex-col gap-0 transition-colors ${
                currentThreadId === t.id
                  ? 'bg-[#0d2d4a] text-[#cde]'
                  : 'text-[#777] hover:bg-[#1a1a1a] hover:text-[#ccc]'
              }`}>
              <span className="text-xs truncate leading-snug">{t.title || '未命名对话'}</span>
              <span className="text-[10px] text-[#444]">{relativeTime(t.updatedAt)}</span>
            </button>
          ))}
          {group.threads.length > 8 && (
            <button type="button" className="w-full text-left px-3 py-0.5 text-[10px] text-[#444] hover:text-[#666]">
              展开显示
            </button>
          )}
          {group.threads.length === 0 && (
            <div className="px-3 py-1 text-[10px] text-[#3a3a3a]">暂无对话</div>
          )}
        </div>
      )}
    </div>
  )
}
