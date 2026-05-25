import { useEffect } from 'react'
import { useGlobalStore } from './stores/global.store'
import AgentLayout from './layouts/AgentLayout'
import IDELayout from './layouts/IDELayout'
import TitleBar from './TitleBar'

export default function App() {
  const mode = useGlobalStore((s) => s.ui.mode)
  const setMode = useGlobalStore((s) => s.setMode)

  useEffect(() => {
    const off = window.electronAPI?.onFsChange?.(() => {})
    window.addEventListener('menu:switchMode', ((e: CustomEvent<'agent' | 'ide'>) => {
      setMode(e.detail)
    }) as EventListener)
    return () => {
      off?.()
    }
  }, [setMode])

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] text-[#cccccc] overflow-hidden select-none">
      <TitleBar />
      {/* Both layouts stay mounted; visibility toggled via display to preserve Monaco + PTY state */}
      <div className={`${mode === 'agent' ? 'flex' : 'hidden'} flex-1 flex-col overflow-hidden`}>
        <AgentLayout />
      </div>
      <div className={`${mode === 'ide' ? 'flex' : 'hidden'} flex-1 flex-col overflow-hidden`}>
        <IDELayout />
      </div>
    </div>
  )
}
