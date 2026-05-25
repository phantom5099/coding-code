import { useAgent } from '../hooks/useAgent'
import AgentSidebar from '../agent/AgentSidebar'
import AgentWorkspace from '../agent/AgentWorkspace'

export default function AgentLayout() {
  // Mount agent IPC subscriptions (loads threads, registers event handlers)
  useAgent()

  return (
    <div className="flex h-full overflow-hidden">
      <AgentSidebar />
      <AgentWorkspace />
    </div>
  )
}
