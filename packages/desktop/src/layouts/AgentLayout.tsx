import { useAgentCore } from '../hooks/useAgent';
import { useGlobalStore } from '../stores/global.store';
import ProjectStrip from '../agent/ProjectStrip';
import AgentSidebar from '../agent/AgentSidebar';
import AgentWorkspace from '../agent/AgentWorkspace';
import GlobalSettingsPage from '../settings/GlobalSettingsPage';
import ProjectSettingsPage from '../settings/ProjectSettingsPage';

export default function AgentLayout() {
  const { sendMessage, abort } = useAgentCore();
  const view = useGlobalStore((s) => s.ui.view);

  if (view === 'global-settings') {
    return <GlobalSettingsPage />;
  }

  if (view === 'project-settings') {
    return <ProjectSettingsPage />;
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <ProjectStrip />
      <AgentSidebar />
      <AgentWorkspace sendMessage={sendMessage} abort={abort} />
    </div>
  );
}
