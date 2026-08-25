import { useState, useEffect } from 'react';
import { Eye, Hammer, Loader2 } from 'lucide-react';
import { useAgentProfile } from '../hooks/useAgent';
import { useAgentStore } from '../stores/agent.store';
import type { AgentProfileName } from '@codingcode/core/subagent/types';

interface ProfileIndicatorProps {
  sessionId: string | null;
  cwd: string;
}

const PROFILE_META: Record<AgentProfileName, { label: string; color: string; Icon: typeof Eye }> = {
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

/** Shows and switches the active agent profile. */
export default function ProfileIndicator({ sessionId, cwd }: ProfileIndicatorProps) {
  const { fetchProfile, switchProfile } = useAgentProfile();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const profile = useAgentStore((s) =>
    sessionId ? (s.profileByThreadId[sessionId] ?? null) : null
  );
  const pendingProfile = useAgentStore((s) => s.pendingProfile);
  const setPendingProfile = useAgentStore((s) => s.setPendingProfile);
  const setProfileForThread = useAgentStore((s) => s.setProfileForThread);
  const setOptimisticProfileForThread = useAgentStore((s) => s.setOptimisticProfileForThread);

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) return;

    const existing = useAgentStore.getState().profileByThreadId[sessionId];
    if (existing && !existing.optimistic) return;

    if (!existing) {
      const permissionMode = 'default' as const;
      setOptimisticProfileForThread(sessionId, {
        activeProfile: pendingProfile,
        permissionMode,
      });
    }

    setLoading(true);
    const requestedAt = Date.now();
    fetchProfile(sessionId, cwd)
      .then((info) => {
        if (cancelled) return;
        setProfileForThread(sessionId, {
          activeProfile: info.activeProfile,
          permissionMode: info.permissionMode,
          requestedAt,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('Failed to fetch session profile:', e);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    cwd,
    fetchProfile,
    pendingProfile,
    setProfileForThread,
    setOptimisticProfileForThread,
  ]);

  const current: AgentProfileName =
    sessionId === null ? pendingProfile : (profile?.activeProfile ?? 'build');
  const target: AgentProfileName = current === 'plan' ? 'build' : 'plan';

  const handleToggle = async () => {
    if (busy) return;

    if (sessionId === null) {
      setPendingProfile(target);
      return;
    }

    setBusy(true);
    try {
      const result = await switchProfile(sessionId, target, cwd);
      setProfileForThread(sessionId, {
        activeProfile: result.activeProfile,
        permissionMode: result.permissionMode,
      });
    } catch (e) {
      console.error('Failed to switch profile:', e);
    } finally {
      setBusy(false);
    }
  };

  const meta = PROFILE_META[current];
  const Icon = meta.Icon;
  const disabled = sessionId === null ? false : loading || busy;

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled}
      data-testid="profile-indicator"
      title={
        sessionId === null
          ? `新会话将以 ${meta.label} 启动，点击切换到 ${PROFILE_META[target].label}`
          : `当前 ${meta.label}，点击切换到 ${PROFILE_META[target].label}`
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
