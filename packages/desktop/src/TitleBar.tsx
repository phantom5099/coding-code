import { useUIStore } from './stores/ui.store';

const isWindows = window.electronAPI?.platform === 'win32';

export default function TitleBar() {
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);

  if (!isWindows) return null;

  return (
    <div
      className="shrink-0 flex items-center px-3 bg-[var(--bg-card)] select-none"
      style={
        {
          height: 'env(titlebar-area-height, 36px)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    >
      <span className="text-[var(--text-tertiary)] text-xs font-medium">Coding Code</span>
      <div
        className="flex items-center gap-0.5 ml-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setMode('agent')}
          className={`px-3 h-6 text-xs rounded transition-colors ${
            mode === 'agent'
              ? 'bg-[var(--accent-primary)] text-[var(--text-inverse)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          Agent
        </button>
        <button
          onClick={() => setMode('ide')}
          className={`px-3 h-6 text-xs rounded transition-colors ${
            mode === 'ide'
              ? 'bg-[var(--accent-primary)] text-[var(--text-inverse)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          IDE
        </button>
      </div>
    </div>
  );
}
