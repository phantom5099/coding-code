import { useGlobalStore } from '../stores/global.store'

export default function AgentLayout() {
  const setMode = useGlobalStore((s) => s.setMode)

  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-6 bg-[#1e1e1e]">
      <h1 className="text-2xl font-semibold text-[#cccccc]">Agent 模式</h1>
      <p className="text-[#888] text-sm">Phase 2 中实现完整 Agent 布局</p>
      <button
        onClick={() => setMode('ide')}
        className="px-4 py-2 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-sm transition-colors"
      >
        切换到 IDE 模式 (Ctrl+Shift+E)
      </button>
    </div>
  )
}
