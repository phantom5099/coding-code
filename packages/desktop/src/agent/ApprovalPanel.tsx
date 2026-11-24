import { useState, useMemo } from 'react';
import type { Item } from '@shared/types';
import { useAgentStore } from '../stores/agent.store';
import { useAgentApproval } from '../hooks/useAgent';
import ToolCallCard from '../shared/ToolCallCard';
import { Square } from 'lucide-react';

interface ApprovalPanelProps {
  threadId: string;
  inline?: boolean;
  onStop?: () => void;
}

export default function ApprovalPanel({ threadId, inline = false, onStop }: ApprovalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { approveTool, rejectTool } = useAgentApproval();

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

  if (pendingItems.length === 0) return null;

  if (inline) {
    return (
      <div className="cc-inline-approval shrink-0 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-card)]">
          <span className="text-[13px] font-medium text-[var(--text-primary)]">需要确认的操作</span>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--text-muted)]">{pendingItems.length} 项</span>
            {onStop && (
              <button
                type="button"
                onClick={onStop}
                aria-label="停止生成"
                title="停止生成"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--border-hover)] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
              >
                <Square size={12} fill="currentColor" />
              </button>
            )}
          </div>
        </div>
        <div className="max-h-44 overflow-y-auto px-2 py-1">
          {pendingItems.map((item) => (
            <ToolCallCard
              key={item.id}
              item={item}
              threadId={threadId}
              onApprove={approveTool}
              onReject={rejectTool}
              compact
            />
          ))}
        </div>
      </div>
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
