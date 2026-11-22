import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import type { Item } from '@shared/types';
import ToolSummary from './ToolSummary';

export interface ToolCallEntry {
  item: Item & { type: 'tool_call' };
  toolResult?: Item & { type: 'tool_result' };
}

function statusLabel(entries: ToolCallEntry[]): string {
  if (entries.some(({ item }) => item.status === 'running')) return '执行中';
  if (entries.some(({ item }) => item.status === 'pending')) return '等待审批';
  return '已完成';
}

export default function ToolCallGroup({ entries }: { entries: ToolCallEntry[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 1) return <ToolSummary toolCall={entries[0]!.item} toolResult={entries[0]!.toolResult} />;
  const status = statusLabel(entries);
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
                <ToolSummary toolCall={item} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
