import { useAgent } from '../hooks/useAgent'
import { useGlobalStore } from '../stores/global.store'
import AgentSidebar from '../agent/AgentSidebar'
import AgentWorkspace from '../agent/AgentWorkspace'
import SettingsPage from '../settings/SettingsPage'

export default function AgentLayout() {
  useAgent()
  const view = useGlobalStore((s) => s.ui.view)

  return (
    <>
      {view === 'settings' ? (
        <SettingsPage />
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <AgentSidebar />
          <AgentWorkspace />
        </div>
      )}
    </>
  )
}
