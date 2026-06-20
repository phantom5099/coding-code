import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, Eye, Hammer, Loader2 } from 'lucide-react';
import { useAgentMode, type SessionModeSnapshot } from '../hooks/useAgent';

interface ModeIndicatorProps {
  sessionId: string | null;
  cwd: string;
  onPlanPanelOpen?: () => void;
}

type ModeValue = 'plan' | 'build';

const MODE_META: Record<ModeValue, { label: string; color: string; Icon: typeof Eye }> = {
  plan: {
    label: '计划模式',
    color: 'text-[var(--accent-warning)] bg-[var(--tag-info-bg)]',
    Icon: Eye,
  },
  build: {
    label: '构建模式',
    color: 'text-[var(--accent-success)] bg-[var(--tag-action-bg)]',
    Icon: Hammer,
  },
};

/**
 * Compact status-bar pill that shows the current plan/build mode for the
 * active session. Clicking it opens a popover with a switch button + a
 * shortcut to open the PlanPanel.
 */
export default function ModeIndicator({ sessionId, cwd, onPlanPanelOpen }: ModeIndicatorProps) {
  const { fetchMode, switchMode } = useAgentMode();
  const [mode, setMode] = useState<SessionModeSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Fetch on sessionId / cwd change
  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setMode(null);
      return;
    }
    setLoading(true);
    fetchMode(sessionId, cwd)
      .then((m) => {
        if (cancelled) return;
        setMode(m);
      })
      .catch((e) => {
        console.error('Failed to fetch session mode:', e);
        if (cancelled) return;
        setMode(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, cwd, fetchMode]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const current: ModeValue = mode?.profileName === 'plan' ? 'plan' : 'build';

  const doSwitch = useCallback(
    async (target: ModeValue) => {
      if (!sessionId || target === current) {
        setOpen(false);
        return;
      }
      setBusy(true);
      try {
        await switchMode(sessionId, target, cwd);
        // Re-fetch to pick up the new mode from server
        const m = await fetchMode(sessionId, cwd);
        setMode(m);
      } catch (e) {
        console.error('Failed to switch mode:', e);
      } finally {
        setBusy(false);
        setOpen(false);
      }
    },
    [sessionId, cwd, current, switchMode, fetchMode]
  );

  if (!sessionId) return null;

  const meta = MODE_META[current];
  const Icon = meta.Icon;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        data-testid="mode-indicator"
        title="当前主代理模式"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium ${meta.color} hover:opacity-90 transition-opacity disabled:opacity-50`}
      >
        {loading ? (
          <Loader2 size={12} strokeWidth={1.8} className="animate-spin" />
        ) : (
          <Icon size={12} strokeWidth={1.8} />
        )}
        <span>{meta.label}</span>
        <span className="text-[10px] opacity-70">▾</span>
      </button>
      {open && (
        <div
          ref={popRef}
          data-testid="mode-popover"
          className="absolute right-0 top-full mt-1 z-30 w-[260px] bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-lg shadow-2xl overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-[var(--border-card)]">
            <div className="text-[12px] text-[var(--text-tertiary)]">主代理模式</div>
            <div className="text-[13px] text-[var(--text-primary)] mt-0.5">
              {meta.label}
              {mode?.permissionMode && (
                <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">
                  · {mode.permissionMode}
                </span>
              )}
            </div>
          </div>
          <div className="py-1">
            {(['plan', 'build'] as ModeValue[]).map((m) => {
              const mm = MODE_META[m];
              const MIcon = mm.Icon;
              const active = m === current;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => void doSwitch(m)}
                  data-testid={`mode-option-${m}`}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors ${
                    active
                      ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  } disabled:opacity-50`}
                >
                  <MIcon size={14} strokeWidth={1.5} className={active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'} />
                  <span className="flex-1 text-left">{mm.label}</span>
                  {active && <Check size={14} strokeWidth={1.8} className="text-[var(--accent-success)]" />}
                </button>
              );
            })}
          </div>
          {onPlanPanelOpen && (
            <div className="border-t border-[var(--border-card)] py-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPlanPanelOpen();
                }}
                className="w-full px-3 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                查看当前计划…
              </button>
            </div>
          )}
          {mode?.available && mode.available.length > 0 && (
            <div className="px-3 py-2 border-t border-[var(--border-card)] text-[11px] text-[var(--text-muted)]">
              {mode.available.length} 个可用配置
            </div>
          )}
        </div>
      )}
    </div>
  );
}
