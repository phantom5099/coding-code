import { useState, useMemo, useCallback } from 'react';
import type { Item } from '@shared/types';
import { useAgentStore } from '../stores/agent.store';
import { useAgentApproval, type PlanChoice } from '../hooks/useAgent';
import ToolCallCard from '../shared/ToolCallCard';
import PlanApprovalModal from '../shared/PlanApprovalModal';

interface ApprovalPanelProps {
  threadId: string;
}

type SubmitPlanItem = Item & {
  type: 'tool_call';
  name: 'submit_plan';
  status: 'pending';
  args: { plan_content?: string; [k: string]: unknown };
  payload?: Record<string, unknown>;
};

function isSubmitPlanItem(item: Item): item is SubmitPlanItem {
  return (
    item.type === 'tool_call' &&
    item.name === 'submit_plan' &&
    item.status === 'pending'
  );
}

export default function ApprovalPanel({ threadId }: ApprovalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { approveTool, rejectTool, submitPlanChoice } = useAgentApproval();

  // Stable string key: only changes when pending item IDs change, not on every content update
  const pendingKey = useAgentStore((s) => {
    const thread = s.threads[threadId];
    if (!thread) return '';
    return thread.turns
      .flatMap((t) => t.items)
      .filter((i) => i.type === 'tool_call' && i.status === 'pending')
      .map((i) => i.id)
      .join(',');
  });

  // Only compute pending items when the key changes
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

  // Track the first submit_plan that needs approval; the modal will be shown
  // for this single item at a time (subsequent plans queue behind).
  const planItem = useMemo(() => {
    for (const item of pendingItems) {
      if (isSubmitPlanItem(item as Item)) return item as SubmitPlanItem;
    }
    return null;
  }, [pendingItems]);

  const planContent = planItem?.args?.plan_content ?? '';
  const planPath =
    typeof planItem?.payload?.path === 'string'
      ? (planItem!.payload!.path as string)
      : typeof planItem?.payload?.plan_path === 'string'
        ? (planItem!.payload!.plan_path as string)
        : undefined;

  const handlePlanChoice = useCallback(
    async (callId: string, choice: PlanChoice) => {
      await submitPlanChoice(threadId, callId, choice);
    },
    [submitPlanChoice, threadId]
  );

  if (pendingItems.length === 0) return null;

  // If a submit_plan is pending, the modal takes over the whole screen — do
  // not render the small approval card list to avoid double interaction.
  if (planItem) {
    return (
      <PlanApprovalModal
        planContent={planContent}
        planPath={planPath}
        sessionId={threadId}
        onImplement={() => void handlePlanChoice(planItem.id, { type: 'allow' })}
        onModify={(newContent) =>
          void handlePlanChoice(planItem.id, {
            type: 'modified',
            input: { plan_content: newContent },
          })
        }
        onCancel={() => void handlePlanChoice(planItem.id, { type: 'canceled' })}
      />
    );
  }

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
