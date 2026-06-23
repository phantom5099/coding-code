import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Item } from '@shared/types';
import { useAgentStore } from '../stores/agent.store';
import { useAgentApproval, useAgentCore, useAgentMode } from '../hooks/useAgent';
import ToolCallCard from '../shared/ToolCallCard';
import PlanApprovalModal from '../shared/PlanApprovalModal';
import { useWorkspaceStore } from '../stores/workspace.store';

interface ApprovalPanelProps {
  threadId: string;
}

export default function ApprovalPanel({ threadId }: ApprovalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { approveTool, rejectTool } = useAgentApproval();
  const { sendMessage } = useAgentCore();
  const { fetchPlan, switchMode } = useAgentMode();
  const workspace = useWorkspaceStore();

  const pendingPlan = useAgentStore((s) => s.pendingPlanByThreadId[threadId] ?? null);
  const clearPendingPlan = useAgentStore((s) => s.clearPendingPlan);

  const [planContent, setPlanContent] = useState('');
  const [planPath, setPlanPath] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pendingPlan) return;
    let cancelled = false;
    setLoading(true);
    fetchPlan(pendingPlan.sessionId, workspace.rootPath ?? '')
      .then((snap) => {
        if (cancelled) return;
        setPlanContent(snap.content);
        setPlanPath(snap.path);
      })
      .catch(() => {
        if (cancelled) return;
        setPlanContent('');
        setPlanPath(undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingPlan, fetchPlan, workspace.rootPath]);

  const pendingKey = useAgentStore((s) => {
    const thread = s.threads[threadId];
    if (!thread) return '';
    return thread.turns
      .flatMap((t) => t.items)
      .filter((i) => i.type === 'tool_call' && i.status === 'pending')
      .map((i) => i.id)
      .join(',');
  });

  const pendingItems = useMemo(() => {
    if (!pendingKey) return [];
    const thread = useAgentStore.getState().threads[threadId];
    if (!thread) return [];
    return thread.turns.flatMap((turn) =>
      turn.items.filter(
        (i): i is Item & { type: 'tool_call' } => i.type === 'tool_call' && i.status === 'pending'
      )
    );
  }, [pendingKey, threadId]);

  const handleImplement = useCallback(async () => {
    if (!pendingPlan) return;
    const sessionId = pendingPlan.sessionId;
    clearPendingPlan(threadId);
    await switchMode(sessionId, 'build', workspace.rootPath ?? '');
    await sendMessage('Plan approved. Please start implementing it.', workspace.rootPath ?? '');
  }, [pendingPlan, clearPendingPlan, threadId, switchMode, sendMessage, workspace.rootPath]);

  const handleSubmitOpinion = useCallback(
    async (opinion: string) => {
      if (!pendingPlan) return;
      clearPendingPlan(threadId);
      await sendMessage(
        `Please revise the plan based on this feedback:\n\n${opinion}`,
        workspace.rootPath ?? ''
      );
    },
    [pendingPlan, clearPendingPlan, threadId, sendMessage, workspace.rootPath]
  );

  const handleCancel = useCallback(() => {
    clearPendingPlan(threadId);
  }, [clearPendingPlan, threadId]);

  if (pendingPlan) {
    return (
      <PlanApprovalModal
        planContent={planContent}
        planPath={planPath}
        sessionId={pendingPlan.sessionId}
        loading={loading}
        onImplement={() => void handleImplement()}
        onSubmitOpinion={(op) => void handleSubmitOpinion(op)}
        onCancel={() => void handleCancel()}
      />
    );
  }

  if (pendingItems.length === 0) return null;

  if (collapsed) {
    return (
      <div className="fixed bottom-24 right-5 z-40">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[var(--bg-panel)] border border-[var(--border-card)] text-[var(--text-primary)] text-[13px] shadow-lg hover:bg-[var(--bg-hover)] transition-colors"
        >
          <span>🔧</span>
          <span>{pendingItems.length} 个工具等待审批</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-20 right-5 w-[320px] max-h-[70vh] z-40 flex flex-col">
      <div className="rounded-lg bg-[var(--bg-panel)] border border-[var(--border-card)] shadow-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-code-header)] border-b border-[var(--border-card)]">
          <div className="flex items-center gap-2">
            <span>🔧</span>
            <span className="text-[13px] text-[var(--text-primary)] font-medium">
              工具审批 ({pendingItems.length})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[16px] leading-none transition-colors"
          >
            −
          </button>
        </div>
        <div className="overflow-y-auto p-3 flex-1">
          {pendingItems.map((item) => (
            <ToolCallCard
              key={item.id}
              item={item}
              threadId={threadId}
              onApprove={approveTool}
              onReject={rejectTool}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
