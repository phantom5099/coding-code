import { useEffect } from 'react';
import { useAgentCore } from './hooks/useAgent';
import { useUIStore } from './stores/ui.store';
import { useWorkspaceStore } from './stores/workspace.store';
import { AutomationPanel } from './agent/AutomationPanel';
import ProjectStrip from './agent/ProjectStrip';
import AgentSidebar from './agent/AgentSidebar';
import AgentWorkspace from './agent/AgentWorkspace';
import GlobalSettingsPage from './settings/GlobalSettingsPage';
import ProjectSettingsPage from './settings/ProjectSettingsPage';
import TitleBar from './TitleBar';
import ErrorBoundary from './shared/ErrorBoundary';

export default function App() {
  const { sendMessage, sendQueuedInput, abort } = useAgentCore();
  const theme = useUIStore((s) => s.theme);
  const view = useUIStore((s) => s.view);
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  useEffect(() => {
    if (rootPath) {
      window.electronAPI?.setWorkspaceCwd?.(rootPath);
    }
  }, [rootPath]);

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

  let page;
  if (view === 'global-settings') {
    page = <GlobalSettingsPage />;
  } else if (view === 'project-settings') {
    page = <ProjectSettingsPage />;
  } else if (view === 'automation') {
    page = <AutomationPanel />;
  } else {
    page = (
      <>
        <AgentSidebar />
        <AgentWorkspace sendMessage={sendMessage} sendQueuedInput={sendQueuedInput} abort={abort} />
      </>
    );
  }

  return (
    <ErrorBoundary>
      <div className="cc-app-root h-screen flex flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
        <TitleBar />
        <div className="cc-app-content flex min-h-0 flex-1 overflow-hidden">
          <ProjectStrip />
          <main className="cc-page-container flex min-w-0 flex-1 overflow-hidden">{page}</main>
        </div>
      </div>
    </ErrorBoundary>
  );
}
