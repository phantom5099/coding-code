import { useAgentCore } from '../hooks/useAgent';
import { useUIStore } from '../stores/ui.store';
import ProjectStrip from '../agent/ProjectStrip';
import AgentSidebar from '../agent/AgentSidebar';
import AgentWorkspace from '../agent/AgentWorkspace';
import { AutomationPanel } from '../agent/AutomationPanel';
import GlobalSettingsPage from '../settings/GlobalSettingsPage';
import ProjectSettingsPage from '../settings/ProjectSettingsPage';

export default function AgentLayout() {
  const { sendMessage, abort } = useAgentCore();
  const view = useUIStore((s) => s.view);

  if (view === 'global-settings') {
    return <GlobalSettingsPage />;
  }

  if (view === 'project-settings') {
    return <ProjectSettingsPage />;
  }

  if (view === 'automation') {
    return <AutomationPanel />;
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <ProjectStrip />
      <AgentSidebar />
      <AgentWorkspace sendMessage={sendMessage} abort={abort} />
    </div>
  );
}
