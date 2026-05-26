import { useGlobalStore } from './stores/global.store'

const isWindows = window.electronAPI?.platform === 'win32'

export default function TitleBar() {
  const mode = useGlobalStore((s) => s.ui.mode)
  const setMode = useGlobalStore((s) => s.setMode)

  if (!isWindows) return null

  return (
    <div
      className="shrink-0 flex items-center px-3 bg-[#1a1a1a] select-none"
      style={{
        height: 'env(titlebar-area-height, 36px)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <span className="text-[#858585] text-xs font-medium">Coding Code</span>
      <div
        className="flex items-center gap-0.5 ml-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setMode('agent')}
          className={`px-3 h-6 text-xs rounded transition-colors ${
            mode === 'agent'
              ? 'bg-[#0e639c] text-white'
              : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#2d2d2d]'
          }`}
        >
          Agent
        </button>
        <button
          onClick={() => setMode('ide')}
          className={`px-3 h-6 text-xs rounded transition-colors ${
            mode === 'ide'
              ? 'bg-[#0e639c] text-white'
              : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#2d2d2d]'
          }`}
        >
          IDE
        </button>
      </div>
    </div>
  )
}
