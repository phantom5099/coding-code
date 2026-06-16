import { useEffect } from 'react';
import { useUIStore } from './stores/ui.store';
import { useWorkspaceStore } from './stores/workspace.store';
import AgentLayout from './layouts/AgentLayout';
import IDELayout from './layouts/IDELayout';
import TitleBar from './TitleBar';
import ErrorBoundary from './shared/ErrorBoundary';

export default function App() {
  const mode = useUIStore((s) => s.mode);
  const theme = useUIStore((s) => s.theme);
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

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-[var(--bg-base)] text-[var(--text-primary)] overflow-hidden">
        <TitleBar />
        {/* Both layouts stay mounted; visibility toggled via display to preserve Monaco + PTY state */}
        <div className={`${mode === 'agent' ? 'flex' : 'hidden'} flex-1 flex-col overflow-hidden`}>
          <AgentLayout />
        </div>
        <div className={`${mode === 'ide' ? 'flex' : 'hidden'} flex-1 flex-col overflow-hidden`}>
          <IDELayout />
        </div>
      </div>
    </ErrorBoundary>
  );
}
