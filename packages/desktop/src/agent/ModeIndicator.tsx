import { useState, useEffect } from 'react';
import { Eye, Hammer, Loader2 } from 'lucide-react';
import { useAgentMode } from '../hooks/useAgent';
import { useAgentStore } from '../stores/agent.store';
import type { SessionMode } from '@codingcode/core/session/types';

interface ModeIndicatorProps {
  sessionId: string | null;
  cwd: string;
}

const MODE_META: Record<SessionMode, { label: string; color: string; Icon: typeof Eye }> = {
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
 * Compact status-bar pill that shows the current plan/build mode.
 *
 * Two modes of operation:
 *  - `sessionId !== null` — reads the live mode from the agent store and
 *    toggles by calling `switchMode` (server round-trip).
 *  - `sessionId === null` — welcome screen / no session yet. Shows the
 *    `pendingProfile` from the agent store and toggles it locally; the
 *    value is used as the initial mode when the user starts a session.
 */
export default function ModeIndicator({ sessionId, cwd }: ModeIndicatorProps) {
  const { fetchMode, switchMode } = useAgentMode();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const mode = useAgentStore((s) =>
    sessionId ? (s.modeByThreadId[sessionId] ?? null) : null
  );
  const pendingProfile = useAgentStore((s) => s.pendingProfile);
  const setPendingProfile = useAgentStore((s) => s.setPendingProfile);
  const setModeForThread = useAgentStore((s) => s.setModeForThread);
  const setOptimisticModeForThread = useAgentStore((s) => s.setOptimisticModeForThread);

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) return;

    const existing = useAgentStore.getState().modeByThreadId[sessionId];
    if (existing && !existing.optimistic) return;

    if (!existing) {
      const permissionMode: 'default' = 'default';
      setOptimisticModeForThread(sessionId, {
        mode: pendingProfile,
        permissionMode,
      });
    }

    setLoading(true);
    const requestedAt = Date.now();
    fetchMode(sessionId, cwd)
      .then((info) => {
        if (cancelled) return;
        setModeForThread(sessionId, {
          mode: info.mode,
          permissionMode: info.permissionMode,
          requestedAt,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('Failed to fetch session mode:', e);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, cwd, fetchMode, pendingProfile, setModeForThread, setOptimisticModeForThread]);

  const current: SessionMode =
    sessionId === null ? pendingProfile : (mode?.mode ?? 'build');
  const target: SessionMode = current === 'plan' ? 'build' : 'plan';

  const handleToggle = async () => {
    if (busy) return;

    if (sessionId === null) {
      setPendingProfile(target);
      return;
    }

    setBusy(true);
    try {
      const result = await switchMode(sessionId, target, cwd);
      setModeForThread(sessionId, {
        mode: result.mode,
        permissionMode: result.permissionMode,
      });
    } catch (e) {
      console.error('Failed to switch mode:', e);
    } finally {
      setBusy(false);
    }
  };

  const meta = MODE_META[current];
  const Icon = meta.Icon;
  const disabled = sessionId === null ? false : loading || busy;

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled}
      data-testid="mode-indicator"
      title={
        sessionId === null
          ? `新会话将以 ${meta.label} 启动，点击切换到 ${MODE_META[target].label}`
          : `当前 ${meta.label}，点击切换到 ${MODE_META[target].label}`
      }
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium ${meta.color} hover:opacity-90 transition-opacity disabled:opacity-50`}
    >
      {loading || busy ? (
        <Loader2 size={12} strokeWidth={1.8} className="animate-spin" />
      ) : (
        <Icon size={12} strokeWidth={1.8} />
      )}
      <span>{meta.label}</span>
    </button>
  );
}
