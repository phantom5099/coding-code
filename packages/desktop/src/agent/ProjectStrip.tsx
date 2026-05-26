import { useState } from 'react'
import { useGlobalStore } from '../stores/global.store'
import type { Project, Thread } from '@shared/types'

function normalizeCwd(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, l: string) => `${l.toLowerCase()}:`)
}

const PROJECT_COLORS = [
  'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-fuchsia-600', 'bg-lime-600',
]

function colorForId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]!
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

interface SessionListPopupProps {
  project: Project
  threads: Thread[]
  currentThreadId: string | null
  onSelectThread: (id: string) => void
}

function SessionListPopup({ project, threads, currentThreadId, onSelectThread }: SessionListPopupProps) {
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <div className="absolute left-full top-0 ml-1 w-60 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-2xl z-50">
      <div className="px-3 py-2 border-b border-[#2a2a2a]">
        <span className="text-[12px] font-semibold text-[#777] uppercase tracking-wider">{project.name}</span>
      </div>
      <div className="max-h-80 overflow-y-auto py-1">
        {sorted.slice(0, 12).map((t) => (
          <button type="button" key={t.id} onClick={() => onSelectThread(t.id)}
            className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
              currentThreadId === t.id
                ? 'bg-[#0d2d4a] text-[#cde]'
                : 'text-[#888] hover:bg-[#252525] hover:text-[#ccc]'
            }`}>
            <span className="flex-1 text-[13px] truncate">{t.title || '未命名对话'}</span>
            <span className="text-[11px] text-[#444] shrink-0">{relativeTime(t.updatedAt)}</span>
          </button>
        ))}
        {sorted.length === 0 && (
          <div className="px-3 py-3 text-[13px] text-[#3a3a3a]">暂无对话</div>
        )}
        {sorted.length > 12 && (
          <div className="px-3 py-1 text-[12px] text-[#3a3a3a]">
            +{sorted.length - 12} 条更多
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProjectStrip() {
  const projects = useGlobalStore((s) => s.workspace.projects)
  const currentProjectId = useGlobalStore((s) => s.workspace.currentProjectId)
  const threads = useGlobalStore((s) => s.agent.threads)
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId)
  const sidebarCollapsed = useGlobalStore((s) => s.ui.sidebarCollapsed)
  const switchProject = useGlobalStore((s) => s.switchProject)
  const addProject = useGlobalStore((s) => s.addProject)
  const setCurrentThread = useGlobalStore((s) => s.setCurrentThread)

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const handleSelectProject = (id: string) => {
    switchProject(id)
  }

  const handleAddProject = async () => {
    const folder = await window.electronAPI?.openFolderDialog?.()
    if (!folder) return
    const project = await window.electronAPI?.addProject?.(folder)
    if (project) {
      addProject(project)
      switchProject(project.id)
      window.electronAPI?.setCurrentProjectId?.(project.id)
    }
  }

  const getThreadsForProject = (rootPath: string): Thread[] => {
    const normalizedRoot = normalizeCwd(rootPath)
    return Object.values(threads).filter((t) => {
      const tcwd = normalizeCwd(t.cwd)
      return tcwd.startsWith(normalizedRoot)
    })
  }

  return (
    <div className="flex flex-col items-center w-12 shrink-0 bg-[#111] border-r border-[#222] pt-3 pb-2 gap-4">
      {projects.map((p) => {
        const isActive = p.id === currentProjectId
        const colorClass = colorForId(p.id)
        return (
          <div
            key={p.id}
            className="relative"
            onMouseEnter={() => sidebarCollapsed ? setHoveredId(p.id) : null}
            onMouseLeave={() => setHoveredId(null)}
          >
            <button
              type="button"
              onClick={() => handleSelectProject(p.id)}
              title={p.name}
              className={`w-9 h-9 rounded-lg flex items-center justify-center text-[15px] font-semibold text-white transition-all shrink-0
                ${colorClass} ${isActive ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-[#111]' : 'opacity-70 hover:opacity-100'}`}
            >
              {p.name.charAt(0).toUpperCase()}
            </button>
            {sidebarCollapsed && hoveredId === p.id && (
              <SessionListPopup
                project={p}
                threads={getThreadsForProject(p.rootPath)}
                currentThreadId={currentThreadId}
                onSelectThread={(tid) => {
                  setCurrentThread(tid)
                  setHoveredId(null)
                }}
              />
            )}
          </div>
        )
      })}

      {/* Divider before add button */}
      {projects.length > 0 && <div className="w-6 border-t border-[#2a2a2a] my-1" />}

      <button
        type="button"
        onClick={handleAddProject}
        title="添加项目"
        className="w-9 h-9 rounded-lg flex items-center justify-center text-[#555] hover:text-[#ccc] hover:bg-[#252525] transition-colors text-lg shrink-0"
      >
        +
      </button>
    </div>
  )
}
