export default function TitleBar() {
  if (window.electronAPI?.platform !== 'win32') return null;

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
    </div>
  );
}
