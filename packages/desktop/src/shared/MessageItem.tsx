import { useState, useRef, useLayoutEffect, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check } from 'lucide-react';
import type { Item } from '@shared/types';
import ToolCallCard from './ToolCallCard';
import DiffBlock from './DiffBlock';
import ToolSummary from './ToolSummary';
import MarkdownRenderer from './MarkdownRenderer';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

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

const MENU_WIDTH = 130;
const MENU_HEIGHT_EST = 70;

const MessageItem = memo(function MessageItem({
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
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    placement: 'up' | 'down';
  } | null>(null);
  const { copiedId, copy } = useCopyToClipboard();

  const messageContent = item.type === 'message' ? item.content : null;

  const isCopied = copiedId === `msg-${item.id}`;

  const updateMenuPos = useCallback(() => {
    if (!rollbackBtnRef.current) return;
    const rect = rollbackBtnRef.current.getBoundingClientRect();
    const GAP = 4;
    let top = rect.top - MENU_HEIGHT_EST - GAP;
    let placement: 'up' | 'down' = 'up';
    if (top < 40) {
      top = rect.bottom + GAP;
      placement = 'down';
    }
    const left = Math.max(4, rect.right - MENU_WIDTH);
    setMenuPos({ top, left, placement });
  }, []);

  useLayoutEffect(() => {
    if (!rollbackMenuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
  }, [rollbackMenuOpen, updateMenuPos]);

  useEffect(() => {
    if (!rollbackMenuOpen) return;
    const handler = () => updateMenuPos();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [rollbackMenuOpen, updateMenuPos]);

  if (item.type === 'message') {
    const content = item.content;
    const isUser = item.role === 'user';
    const hasRollback = !!(onRollbackHere || onForkFromHere);

    if (isUser) {
      return (
        <div className="flex flex-col items-end mb-4 mt-4 group">
          <div className="relative max-w-[78%] px-4 py-3 rounded-2xl rounded-br-sm bg-[var(--border-card)] text-[var(--text-title)] text-[15px] leading-relaxed whitespace-pre-wrap break-words">
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
                {rollbackMenuOpen &&
                  menuPos &&
                  createPortal(
                    <div
                      ref={rollbackMenuRef}
                      data-testid="rollback-menu"
                      data-placement={menuPos.placement}
                      style={{
                        position: 'fixed',
                        top: menuPos.top,
                        left: menuPos.left,
                        width: MENU_WIDTH,
                        zIndex: 100,
                        background: 'var(--bg-base)',
                        border: '1px solid var(--text-disabled)',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                        padding: '4px 0',
                      }}
                    >
                      {onRollbackHere && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRollbackMenuOpen(false);
                            try {
                              onRollbackHere();
                            } catch (err) {
                              console.error('[rollback] failed:', err);
                            }
                          }}
                          className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
                        >
                          回退到这里
                        </button>
                      )}
                      {onForkFromHere && (
                        <button
                          type="button"
                          data-testid="fork-menu-item"
                          onClick={async (e) => {
                            e.stopPropagation();
                            setRollbackMenuOpen(false);
                            try {
                              await onForkFromHere();
                            } catch (err) {
                              console.error('[fork] failed:', err);
                            }
                          }}
                          className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
                        >
                          Fork from here
                        </button>
                      )}
                    </div>,
                    document.body
                  )}
              </div>
            )}
          </div>
          <div className="mt-1.5 mr-1 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copy(content, `msg-${item.id}`);
              }}
              aria-label="复制消息"
              title="复制"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors ${
                isCopied
                  ? 'bg-[var(--accent-success)] text-[var(--text-inverse)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {isCopied ? <Check size={12} /> : <Copy size={12} />}
              {isCopied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-start mb-1 pl-8 group">
        {messageContent != null && (
          <div className="max-w-[80%] text-[15px] text-[var(--text-primary)] leading-relaxed">
            <MarkdownRenderer content={messageContent} />
            {item.partial && (
              <span className="inline-block w-1.5 h-[1.1em] bg-[var(--accent-primary)] animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        )}
      </div>
    );
  }

  if (item.type === 'reasoning') {
    return (
      <div className="mb-1.5 pl-8">
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
        <div className="mb-1 flex items-center gap-1.5 text-[13px] text-[var(--text-tertiary)] pl-8">
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
      <div className="mb-1 flex items-center gap-1.5 text-[13px] pl-8">
        <span
          className={`font-mono ${isRejected ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'}`}
        >
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
      <div className="mb-1.5 px-4 py-3 pl-8 rounded-lg bg-[var(--accent-danger-bg)] border border-[var(--accent-danger-border)] text-[var(--accent-danger)] text-[14px] leading-relaxed">
        {item.message}
      </div>
    );
  }

  return null;
});

export default MessageItem;
