export function getToggleThumbClassName(checked: boolean): string {
  return `absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-[var(--text-white)] transition-transform ${
    checked ? 'translate-x-4' : 'translate-x-0'
  }`;
}

export default function Toggle({
  checked,
  onChange,
  disabledLabel,
  enabledLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabledLabel?: string;
  enabledLabel?: string;
}) {
  return (
    <button
      type="button"
      title={checked ? (enabledLabel ?? '已启用') : (disabledLabel ?? '已禁用')}
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-[var(--accent-primary)]' : 'bg-[var(--text-disabled)]'
      }`}
    >
      <span className={getToggleThumbClassName(checked)} />
    </button>
  );
}
