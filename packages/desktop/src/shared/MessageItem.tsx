import { useState, useRef, useLayoutEffect } from 'react';
import type { Item } from '@shared/types';
import ToolCallCard from './ToolCallCard';
import DiffBlock from './DiffBlock';
import ToolSummary from './ToolSummary';
import MarkdownRenderer from './MarkdownRenderer';

interface MessageItemProps {
  item: Item;
  threadId: string;
  onApprove: (threadId: string, callId: string) => void;
  onReject: (threadId: string, callId: string) => void;
  callIdToToolName?: Record<string, string>;
  onRollbackHere?: () => void;
  onForkFromHere?: () => void;
  toolResult?: Item & { type: 'tool_result' };
}



export default function MessageItem({
  item,
  threadId,
  onApprove,
  onReject,
  callIdToToolName,
  onRollbackHere,
  onForkFromHere,
  toolResult,
}: MessageItemProps) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [rollbackMenuOpen, setRollbackMenuOpen] = useState(false);
  const rollbackBtnRef = useRef<HTMLButtonElement>(null);
  const rollbackMenuRef = useRef<HTMLDivElement>(null);
  const [menuFlip, setMenuFlip] = useState<{ vertical?: boolean; horizontal?: boolean }>({});

  const messageContent = item.type === 'message' ? item.content : null;
  const isAssistant = item.type === 'message' && item.role === 'assistant';

  // Dynamically flip menu if it would overflow the viewport
  useLayoutEffect(() => {
    if (!rollbackMenuOpen || !rollbackMenuRef.current || !rollbackBtnRef.current) return;
    const menuRect = rollbackMenuRef.current.getBoundingClientRect();
    const btnRect = rollbackBtnRef.current.getBoundingClientRect();
    const flip: { vertical?: boolean; horizontal?: boolean } = {};
    // If menu goes above viewport, flip to below button
    if (menuRect.top < 0) {
      flip.vertical = true;
    }
    // If menu goes beyond right edge, flip to left-align
    if (menuRect.right > window.innerWidth) {
      flip.horizontal = true;
    }
    setMenuFlip(flip);
  }, [rollbackMenuOpen]);

  if (item.type === 'message') {
    const content = item.content;
    const isUser = item.role === 'user';
    const hasRollback = !!(onRollbackHere || onForkFromHere);

    if (isUser) {
      return (
        <div className="flex justify-end mb-4">
          <div className="relative max-w-[78%] px-4 py-3 rounded-2xl rounded-br-sm bg-[var(--border-card)] text-[var(--text-title)] text-[15px] leading-relaxed whitespace-pre-wrap break-words group">
            {content}
            {hasRollback && (
              <div className="absolute -right-1 -bottom-1">
                <button
                  ref={rollbackBtnRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRollbackMenuOpen(!rollbackMenuOpen);
                  }}
                  className="w-5 h-5 rounded-full bg-[var(--text-disabled)] text-[var(--text-secondary)] hover:bg-[var(--text-placeholder)] hover:text-[var(--text-primary)] flex items-center justify-center text-[11px] leading-none transition-opacity"
                  title="回退到此"
                >
                  ↩
                </button>
                {rollbackMenuOpen && (
                  <div
                    ref={rollbackMenuRef}
                    className={`absolute bg-[var(--bg-base)] border border-[var(--text-disabled)] rounded-md shadow-lg py-1 z-50 min-w-[130px] ${
                      menuFlip.vertical ? 'top-6' : 'bottom-6'
                    } ${menuFlip.horizontal ? 'right-0' : 'right-0'}`}
                  >
                    {onRollbackHere && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRollbackMenuOpen(false);
                          onRollbackHere();
                        }}
                        className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
                      >
                        回退到这里
                      </button>
                    )}
                    {onForkFromHere && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRollbackMenuOpen(false);
                          onForkFromHere();
                        }}
                        className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
                      >
                        Fork from here
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-start mb-4">
        <div className="max-w-[88%] text-[15px] text-[var(--text-primary)] leading-relaxed">
          {isAssistant && messageContent != null && (
            <MarkdownRenderer content={messageContent} />
          )}
          {item.partial && (
            <span className="inline-block w-1.5 h-[1.1em] bg-[var(--accent-primary)] animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      </div>
    );
  }

  if (item.type === 'reasoning') {
    return (
      <div className="mb-3">
        <button
          type="button"
          onClick={() => setReasoningOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] text-[var(--text-placeholder)] hover:text-[var(--text-tertiary)] transition-colors"
        >
          <span className={`transition-transform text-[10px] ${reasoningOpen ? 'rotate-90' : ''}`}>
            ▶
          </span>
          思考过程
        </button>
        {reasoningOpen && (
          <div className="mt-2 pl-3 border-l-2 border-[var(--border-card)] text-[13px] text-[var(--text-tertiary)] whitespace-pre-wrap leading-relaxed">
            {item.content}
          </div>
        )}
      </div>
    );
  }

  if (item.type === 'tool_call') {
    if (item.status === 'pending') {
      const a = item.args as Record<string, unknown>;
      const path =
        typeof a.path === 'string' ? a.path : typeof a.file_path === 'string' ? a.file_path : '';
      const cmd = typeof a.command === 'string' ? a.command : '';
      const label = path || cmd || item.name;
      return (
        <div className="mb-2 flex items-center gap-1.5 text-[13px] text-[var(--text-tertiary)]">
          <span className="font-mono text-[var(--text-primary)]">{label}</span>
          <span className="text-[var(--text-muted)]">等待审批</span>
        </div>
      );
    }

    if (toolResult) {
      return <ToolSummary toolCall={item} toolResult={toolResult} />;
    }

    const isRejected = item.status === 'rejected';
    return (
      <div className="mb-2 flex items-center gap-1.5 text-[13px]">
        <span className={`font-mono ${isRejected ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'}`}>
          {item.name}
        </span>
        {item.status === 'running' && (
          <span className="text-[var(--accent-primary)] flex items-center gap-1">
            <span className="inline-block animate-spin">⟳</span> 执行中
          </span>
        )}
        {isRejected && <span className="text-[var(--text-muted)]">✗ 已拒绝</span>}
      </div>
    );
  }

  if (item.type === 'tool_result') {
    return null;
  }

  if (item.type === 'error') {
    return (
      <div className="mb-3 px-4 py-3 rounded-lg bg-[var(--accent-danger-bg)] border border-[var(--accent-danger-border)] text-[var(--accent-danger)] text-[14px] leading-relaxed">
        {item.message}
      </div>
    );
  }

  return null;
}
