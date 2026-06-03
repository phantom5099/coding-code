import { useAgent } from '../hooks/useAgent';
import { useGlobalStore } from '../stores/global.store';
import ProjectStrip from '../agent/ProjectStrip';
import AgentSidebar from '../agent/AgentSidebar';
import AgentWorkspace from '../agent/AgentWorkspace';
import SettingsPage from '../settings/SettingsPage';

export default function AgentLayout() {
  const { sendMessage, abort } = useAgent();
  const view = useGlobalStore((s) => s.ui.view);

  return (
    <>
      {view === 'settings' ? (
        <SettingsPage />
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <ProjectStrip />
          <AgentSidebar />
          <AgentWorkspace sendMessage={sendMessage} abort={abort} />
        </div>
      )}
    </>
  );
}
