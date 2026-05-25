import { useEffect } from 'react'
import { useGlobalStore } from './stores/global.store'
import AgentLayout from './layouts/AgentLayout'
import IDELayout from './layouts/IDELayout'

export default function App() {
  const mode = useGlobalStore((s) => s.ui.mode)
  const setMode = useGlobalStore((s) => s.setMode)

  useEffect(() => {
    const off = window.electronAPI?.onFsChange?.(() => {})
    // Listen for menu-triggered mode switches
    window.addEventListener('menu:switchMode', ((e: CustomEvent<'agent' | 'ide'>) => {
      setMode(e.detail)
    }) as EventListener)
    return () => {
      off?.()
    }
  }, [setMode])

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] text-[#cccccc] overflow-hidden select-none">
      {/* Both layouts stay mounted; visibility toggled via display to preserve Monaco + PTY state */}
      <div
        style={{ display: mode === 'agent' ? 'flex' : 'none' }}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <AgentLayout />
      </div>
      <div
        style={{ display: mode === 'ide' ? 'flex' : 'none' }}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <IDELayout />
      </div>
    </div>
  )
}
