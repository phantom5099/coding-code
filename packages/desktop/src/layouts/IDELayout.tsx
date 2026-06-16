import { useUIStore } from '../stores/ui.store';

export default function IDELayout() {
  const setMode = useUIStore((s) => s.setMode);

  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-6 bg-[var(--bg-hover)]">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">IDE 模式</h1>
      <p className="text-[var(--text-tertiary)] text-sm">Phase 3 中实现完整 IDE 布局</p>
      <button
        onClick={() => setMode('agent')}
        className="px-4 py-2 bg-[var(--accent-primary)] hover:bg-[var(--btn-primary-hover)] text-[var(--text-white)] rounded text-sm transition-colors"
      >
        返回 Agent 模式 (Ctrl+Shift+A)
      </button>
    </div>
  );
}
