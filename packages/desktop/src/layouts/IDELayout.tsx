import { useGlobalStore } from '../stores/global.store'

export default function IDELayout() {
  const setMode = useGlobalStore((s) => s.setMode)

  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-6 bg-[#252526]">
      <h1 className="text-2xl font-semibold text-[#cccccc]">IDE 模式</h1>
      <p className="text-[#888] text-sm">Phase 3 中实现完整 IDE 布局</p>
      <button
        onClick={() => setMode('agent')}
        className="px-4 py-2 bg-[#0e639c] hover:bg-[#1177bb] text-white rounded text-sm transition-colors"
      >
        返回 Agent 模式 (Ctrl+Shift+A)
      </button>
    </div>
  )
}
