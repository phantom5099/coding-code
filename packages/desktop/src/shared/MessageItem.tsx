import { useState, useRef, useLayoutEffect, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Copy, Brain } from 'lucide-react';
import type { Item } from '@shared/types';
import { textOf } from '@shared/parts';
import ToolCallCard from './ToolCallCard';
import DiffBlock from './DiffBlock';
import ToolSummary from './ToolSummary';
import MarkdownRenderer from './MarkdownRenderer';
import MediaView from './MediaView';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

interface MessageItemProps {
  item: Item;
  threadId: string;
  /** 资产按项目定位：气泡里的落盘媒体要靠它拼地址 */
  cwd?: string;
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
  cwd,
  onApprove,
  onReject,
  callIdToToolName,
  onRollbackHere,
  onForkFromHere,
  toolResult,
}: MessageItemProps) {
  const [reasoningOpen, setReasoningOpen] = useState(
    item.type === 'reasoning' && item.partial === true
  );
  const reasoningPartial = item.type === 'reasoning' ? item.partial : undefined;
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

  useEffect(() => {
    if (item.type !== 'reasoning') return;
    setReasoningOpen(item.partial === true);
  }, [item.type, reasoningPartial]);

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
    const parts = item.parts;
    const text = textOf(parts);
    const isUser = item.role === 'user';
    const hasRollback = !!(onRollbackHere || onForkFromHere);

    if (isUser) {
      const mediaParts = parts.filter((p) => p.type === 'media');
      return (
        <div className="cc-message-user flex flex-col items-end mb-4 mt-4 group">
          <div className="cc-user-bubble relative max-w-[78%] px-4 py-3 rounded-2xl rounded-br-sm bg-[var(--border-card)] text-[var(--text-title)] text-[15px] leading-relaxed break-words">
            <div className="flex flex-col items-end gap-2">
              {mediaParts.map((p, i) => (
                <MediaView key={`m${i}`} part={p} cwd={cwd} />
              ))}
              {text && <div className="whitespace-pre-wrap self-stretch">{text}</div>}
            </div>
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
                copy(text, `msg-${item.id}`);
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
      <div className="cc-message-assistant flex flex-col items-start mb-1 pl-8 group">
        {text && (
          <div className="max-w-[80%] text-[15px] text-[var(--text-primary)] leading-relaxed">
            <MarkdownRenderer content={text} partial={item.partial === true} />
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
      <div className="cc-tool-summary cc-reasoning-event mb-1.5 pl-8 pr-8">
        <button
          type="button"
          onClick={() => setReasoningOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-md bg-[var(--border-card)] px-2.5 py-1 text-[13px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--border-hover)]"
        >
          <Brain size={14} strokeWidth={1.7} className="shrink-0 text-[var(--accent-primary)]" />
          <span className="shrink-0 text-[var(--text-primary)]">
            {item.partial ? '思考中' : '已完成思考'}
          </span>
          {reasoningOpen ? (
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-[var(--text-muted)]" />
          ) : (
            <ChevronRight className="ml-auto h-3.5 w-3.5 text-[var(--text-muted)]" />
          )}
        </button>
        {reasoningOpen && (
          <div className="cc-tool-expanded-details pt-1.5">
            <div className="rounded-md bg-[var(--bg-code-header)] px-3 py-2 text-[13px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
            {item.content}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (item.type === 'tool_call') {
    return <ToolSummary toolCall={item} toolResult={toolResult} />;
  }

  if (item.type === 'tool_result') {
    return null;
  }

  if (item.type === 'subagent') {
    const label =
      item.status === 'running' ? '运行中' : item.status === 'completed' ? '已完成' : '已失败';
    const tone =
      item.status === 'failed'
        ? 'text-[var(--accent-danger)]'
        : item.status === 'completed'
          ? 'text-[var(--accent-success)]'
          : 'text-[var(--accent-primary)]';
    return (
      <div
        data-testid={`subagent-${item.sessionId}`}
        className="cc-event-row cc-tool-event mb-1 flex items-center gap-1.5 text-[13px] pl-8"
      >
        <span className="text-[var(--text-muted)]">子代理</span>
        <span className="font-mono text-[var(--text-primary)]">{item.agentName}</span>
        <span className={tone}>{label}</span>
      </div>
    );
  }

  if (item.type === 'ask_user') {
    return (
      <div className="cc-event-row cc-tool-event mb-1 flex items-center gap-1.5 text-[13px] pl-8">
        <span className="text-[var(--text-primary)]">{item.question}</span>
        <span className="text-[var(--text-muted)]">
          {item.status === 'waiting' ? '等待回答' : '已回答'}
        </span>
      </div>
    );
  }

  if (item.type === 'error') {
    return (
      <div className="cc-event-row cc-error-event mb-1.5 px-4 py-3 pl-8 rounded-lg bg-[var(--accent-danger-bg)] border border-[var(--accent-danger-border)] text-[var(--accent-danger)] text-[14px] leading-relaxed">
        {item.message}
      </div>
    );
  }

  return null;
});

export default MessageItem;
