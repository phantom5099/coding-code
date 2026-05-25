import { useAgent } from '../hooks/useAgent'
import { useGlobalStore } from '../stores/global.store'
import AgentSidebar from '../agent/AgentSidebar'
import AgentWorkspace from '../agent/AgentWorkspace'
import SettingsPage from '../settings/SettingsPage'

export default function AgentLayout() {
  // Mount agent IPC subscriptions (loads threads, registers event handlers)
  useAgent()

  const view = useGlobalStore((s) => s.ui.view)

  if (view === 'settings') {
    return <SettingsPage />
  }

  return (
    <div className="flex h-full overflow-hidden">
      <AgentSidebar />
      <AgentWorkspace />
    </div>
  )
}
