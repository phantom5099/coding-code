import { useEffect } from 'react';
import { useGlobalStore } from './stores/global.store';
import AgentLayout from './layouts/AgentLayout';
import IDELayout from './layouts/IDELayout';
import TitleBar from './TitleBar';
import ErrorBoundary from './shared/ErrorBoundary';

export default function App() {
  const mode = useGlobalStore((s) => s.ui.mode);
  const theme = useGlobalStore((s) => s.ui.theme);
  const setMode = useGlobalStore((s) => s.setMode);
  const rootPath = useGlobalStore((s) => s.workspace.rootPath);

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
    const handler = ((e: CustomEvent<'agent' | 'ide'>) => {
      setMode(e.detail);
    }) as EventListener;
    window.addEventListener('menu:switchMode', handler);
    return () => {
      off?.();
      window.removeEventListener('menu:switchMode', handler);
    };
  }, [setMode]);

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
