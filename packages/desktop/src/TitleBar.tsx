export default function TitleBar() {
  if (window.electronAPI?.platform !== 'win32') return null;

  return (
    <div
      className="cc-titlebar shrink-0 flex items-center px-3 select-none"
      style={
        {
          height: 'env(titlebar-area-height, 36px)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    >
      <span className="text-xs font-medium">Coding Code</span>
    </div>
  );
}
