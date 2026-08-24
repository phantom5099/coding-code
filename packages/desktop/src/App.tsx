import { useEffect } from 'react';
import { useAgentCore } from './hooks/useAgent';
import { useUIStore } from './stores/ui.store';
import { useWorkspaceStore } from './stores/workspace.store';
import ProjectStrip from './agent/ProjectStrip';
import AgentSidebar from './agent/AgentSidebar';
import AgentWorkspace from './agent/AgentWorkspace';
import { AutomationPanel } from './agent/AutomationPanel';
import GlobalSettingsPage from './settings/GlobalSettingsPage';
import ProjectSettingsPage from './settings/ProjectSettingsPage';
import TitleBar from './TitleBar';
import ErrorBoundary from './shared/ErrorBoundary';

export default function App() {
  const { sendMessage, abort } = useAgentCore();
  const theme = useUIStore((s) => s.theme);
  const view = useUIStore((s) => s.view);
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  // Sync workspace cwd to main process for git polling
  useEffect(() => {
    if (rootPath) {
      window.electronAPI?.setWorkspaceCwd?.(rootPath);
    }
  }, [rootPath]);

  // Sync theme to document and main process
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.electronAPI?.setTheme?.(theme);
  }, [theme]);

  useEffect(() => {
    const off = window.electronAPI?.onFsChange?.(() => {});
    return () => {
      off?.();
    };
  }, []);

  let content;
  if (view === 'global-settings') {
    content = <GlobalSettingsPage />;
  } else if (view === 'project-settings') {
    content = <ProjectSettingsPage />;
  } else if (view === 'automation') {
    content = <AutomationPanel />;
  } else {
    content = (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <ProjectStrip />
        <AgentSidebar />
        <AgentWorkspace sendMessage={sendMessage} abort={abort} />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)] overflow-hidden">
        <TitleBar />
        <div className="flex flex-1 flex-col overflow-hidden">
          {content}
        </div>
      </div>
    </ErrorBoundary>
  );
}
