import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import type { Item } from '@shared/types';
import ToolSummary from './ToolSummary';

export interface ToolCallEntry {
  item: Item & { type: 'tool_call' };
  toolResult?: Item & { type: 'tool_result' };
}

function pendingLabel(item: ToolCallEntry['item']): string {
  const args = item.args as Record<string, unknown>;
  const path = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : '';
  const command = typeof args.command === 'string' ? args.command : '';
  return path || command || item.name;
}

function statusLabel(entries: ToolCallEntry[]): string {
  if (entries.some(({ item }) => item.status === 'running')) return '执行中';
  if (entries.some(({ item }) => item.status === 'pending')) return '等待审批';
  if (entries.some(({ item }) => item.status === 'rejected')) return '有操作被拒绝';
  return '已完成';
}

export default function ToolCallGroup({ entries }: { entries: ToolCallEntry[] }) {
  const [open, setOpen] = useState(false);
  const status = statusLabel(entries);
  const hasFailure = entries.some(({ toolResult }) => toolResult?.exitCode !== undefined && toolResult.exitCode !== 0);

  return (
    <div className="cc-tool-group">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="cc-tool-group-summary"
        aria-expanded={open}
      >
        <Wrench size={14} strokeWidth={1.7} />
        <span>{status}</span>
        <span className="cc-tool-group-count">{entries.length} 项操作</span>
        {hasFailure && <span className="cc-tool-group-error">有失败</span>}
        <span className="ml-auto shrink-0">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="cc-tool-group-details">
          {entries.map(({ item, toolResult }) => (
            <div key={item.id} className="cc-tool-group-item">
              {toolResult ? (
                <ToolSummary toolCall={item} toolResult={toolResult} />
              ) : (
                <div className="cc-tool-group-pending">
                  <span className="cc-tool-group-dot" />
                  <span className="font-mono">{item.name}</span>
                  <span className="cc-tool-args">{pendingLabel(item) === item.name ? '' : pendingLabel(item)}</span>
                  <span className="cc-tool-group-muted">
                    {item.status === 'pending' ? '等待审批' : item.status === 'running' ? '执行中' : '已拒绝'}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
