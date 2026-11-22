import { useState } from 'react';
import { Terminal } from 'lucide-react';

interface ToolCallItem {
  id: string;
  type: 'tool_call';
  name: string;
  args: object;
  status: 'pending' | 'approved' | 'rejected' | 'running';
}

interface ToolCallCardProps {
  item: ToolCallItem;
  threadId: string;
  onApprove: (threadId: string, callId: string) => void;
  onReject: (threadId: string, callId: string) => void;
  compact?: boolean;
}

export default function ToolCallCard({ item, threadId, onApprove, onReject, compact = false }: ToolCallCardProps) {
  const [argsOpen, setArgsOpen] = useState(true);
  const argsJson = JSON.stringify(item.args, null, 2);
  const isRejected = item.status === 'rejected';
  const hasArgs = argsJson !== '{}';

  return (
    <div
      className={`cc-tool-call-card ${compact ? 'my-1' : 'my-2'} rounded border ${isRejected ? 'border-[var(--border-strong)] opacity-50' : 'border-[var(--border-card)]'} bg-[var(--bg-card)] overflow-hidden`}
    >
      <div className="cc-approval-header px-3 py-2 bg-[var(--bg-code-header)]">
        {hasArgs ? (
          <button
            type="button"
            onClick={() => setArgsOpen((v) => !v)}
            className="cc-approval-tool hover:opacity-80 transition-opacity"
          >
            <Terminal size={14} strokeWidth={1.7} className="shrink-0 text-[var(--text-muted)]" />
            <span
              className={`font-mono shrink-0 text-sm font-medium ${isRejected ? 'line-through text-[var(--text-muted)]' : 'text-[var(--syntax-function)]'}`}
            >
              {item.name}
            </span>
          </button>
        ) : (
          <span
            className={`cc-approval-tool-name font-mono text-sm font-medium ${isRejected ? 'line-through text-[var(--text-muted)]' : 'text-[var(--syntax-function)]'}`}
          >
            {item.name}
          </span>
        )}
        {hasArgs && (
          <span className="cc-approval-args-preview" title={argsJson}>
            {JSON.stringify(item.args)}
          </span>
        )}
        <div className="cc-approval-actions flex items-center gap-1">
          {item.status === 'pending' && (
            <>
              <button
                type="button"
                onClick={() => onApprove(threadId, item.id)}
                className="px-2 py-0.5 text-xs bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/80 text-[var(--text-inverse)] rounded transition-colors"
              >
                批准
              </button>
              <button
                type="button"
                onClick={() => onReject(threadId, item.id)}
                className="px-2 py-0.5 text-xs bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-primary)] rounded transition-colors"
              >
                拒绝
              </button>
            </>
          )}
          {item.status === 'running' && (
            <span className="text-xs text-[var(--accent-primary)] flex items-center gap-1">
              <span className="inline-block animate-spin">⟳</span> 执行中
            </span>
          )}
          {item.status === 'approved' && (
            <span className="text-xs text-[var(--accent-success)]">✓ 已完成</span>
          )}
          {item.status === 'rejected' && (
            <span className="text-xs text-[var(--text-muted)]">✗ 已拒绝</span>
          )}
        </div>
      </div>
      {hasArgs && argsOpen && (
        <div className="cc-approval-args-body px-3 pb-2 pt-1">
          <pre className="m-0 whitespace-pre-wrap break-all text-left font-mono text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {argsJson}
          </pre>
        </div>
      )}
    </div>
  );
}
