import { useState } from 'react';
import type { Item } from '@shared/types';
import { useGlobalStore } from '../stores/global.store';
import { useAgent } from '../hooks/useAgent';
import ToolCallCard from '../shared/ToolCallCard';

interface ApprovalPanelProps {
  threadId: string;
}

export default function ApprovalPanel({ threadId }: ApprovalPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const thread = useGlobalStore((s) => s.agent.threads[threadId]);
  const { approveTool, rejectTool } = useAgent();

  const pendingItems =
    thread?.turns.flatMap((turn) =>
      turn.items.filter(
        (i): i is Item & { type: 'tool_call' } => i.type === 'tool_call' && i.status === 'pending'
      )
    ) ?? [];

  if (pendingItems.length === 0) return null;

  if (collapsed) {
    return (
      <div className="fixed bottom-24 right-5 z-40">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#1e1e1e] border border-[#3c3c3c] text-[#ccc] text-[13px] shadow-lg hover:bg-[#252525] transition-colors"
        >
          <span>🔧</span>
          <span>{pendingItems.length} 个工具等待审批</span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-20 right-5 w-[320px] max-h-[70vh] z-40 flex flex-col">
      <div className="rounded-lg bg-[#1e1e1e] border border-[#3c3c3c] shadow-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 bg-[#252526] border-b border-[#3c3c3c]">
          <div className="flex items-center gap-2">
            <span>🔧</span>
            <span className="text-[13px] text-[#ccc] font-medium">
              工具审批 ({pendingItems.length})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-[#666] hover:text-[#ccc] text-[16px] leading-none transition-colors"
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
