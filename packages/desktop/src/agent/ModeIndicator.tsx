import { useState, useEffect } from 'react';
import { Eye, Hammer, Loader2 } from 'lucide-react';
import { useAgentMode, type SessionModeSnapshot } from '../hooks/useAgent';
import { useAgentStore } from '../stores/agent.store';

interface ModeIndicatorProps {
  sessionId: string | null;
  cwd: string;
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
 * Compact status-bar pill that shows the current plan/build mode.
 *
 * Two modes of operation:
 *  - `sessionId !== null` — fetches the live mode for that session and
 *    toggles by calling `switchMode` (server round-trip).
 *  - `sessionId === null` — welcome screen / no session yet. Shows the
 *    `pendingProfile` from the agent store and toggles it locally; the
 *    value is used as the initial mode when the user starts a session.
 *
 * The popover variant was clipped by the chat input box, so the pill is
 * a direct toggle (no popover).
 */
export default function ModeIndicator({ sessionId, cwd }: ModeIndicatorProps) {
  const { fetchMode, switchMode } = useAgentMode();
  const [mode, setMode] = useState<SessionModeSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const pendingProfile = useAgentStore((s) => s.pendingProfile);
  const setPendingProfile = useAgentStore((s) => s.setPendingProfile);

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

  // Welcome-screen mode: derive from the pending profile (no live session).
  const current: ModeValue =
    sessionId === null ? pendingProfile : mode?.profileName === 'plan' ? 'plan' : 'build';
  const target: ModeValue = current === 'plan' ? 'build' : 'plan';

  const handleToggle = async () => {
    if (busy) return;

    // Welcome screen: persist the pending profile locally. The next
    // session created will pick it up as the initial mode.
    if (sessionId === null) {
      setPendingProfile(target);
      return;
    }

    setBusy(true);
    try {
      await switchMode(sessionId, target, cwd);
      const m = await fetchMode(sessionId, cwd);
      setMode(m);
    } catch (e) {
      console.error('Failed to switch mode:', e);
    } finally {
      setBusy(false);
    }
  };

  const meta = MODE_META[current];
  const Icon = meta.Icon;
  // On the welcome screen, the pill is purely UI — no async fetch, so
  // `loading` is meaningless. `busy` is also only meaningful with a
  // live session.
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
