import { useState, useRef, useLayoutEffect, useMemo } from 'react';
import type { Item } from '@shared/types';
import CodeBlock from './CodeBlock';
import ToolCallCard from './ToolCallCard';
import DiffBlock from './DiffBlock';
import ToolSummary from './ToolSummary';

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

function parseMarkdown(text: string): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/```(\w*)\n?([\s\S]*?)```/);
    if (codeMatch && codeMatch.index !== undefined) {
      if (codeMatch.index > 0) {
        blocks.push(
          <span key={key++} className="whitespace-pre-wrap">
            {remaining.slice(0, codeMatch.index)}
          </span>
        );
      }
      blocks.push(
        <CodeBlock key={key++} code={codeMatch[2] ?? ''} language={codeMatch[1] || undefined} />
      );
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length);
    } else {
      blocks.push(
        <span key={key++} className="whitespace-pre-wrap">
          {remaining}
        </span>
      );
      break;
    }
  }

  return <>{blocks}</>;
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

  // Cache markdown parsing — only re-parses when content changes
  const messageContent = item.type === 'message' ? item.content : null;
  const isAssistant = item.type === 'message' && item.role === 'assistant';
  const parsedContent = useMemo(
    () => (isAssistant && messageContent != null ? parseMarkdown(messageContent) : null),
    [isAssistant, messageContent]
  );

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
          <div className="relative max-w-[78%] px-4 py-3 rounded-2xl rounded-br-sm bg-[#2a2a2a] text-[#e8e8e8] text-[15px] leading-relaxed whitespace-pre-wrap break-words group">
            {content}
            {hasRollback && (
              <div className="absolute -right-1 -bottom-1">
                <button
                  ref={rollbackBtnRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRollbackMenuOpen(!rollbackMenuOpen);
                  }}
                  className="w-5 h-5 rounded-full bg-[#444] text-[#aaa] hover:bg-[#555] hover:text-[#ccc] flex items-center justify-center text-[11px] leading-none transition-opacity"
                  title="回退到此"
                >
                  ↩
                </button>
                {rollbackMenuOpen && (
                  <div
                    ref={rollbackMenuRef}
                    className={`absolute bg-[#1e1e1e] border border-[#444] rounded-md shadow-lg py-1 z-50 min-w-[130px] ${
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
                        className="block w-full text-left px-3 py-1.5 text-[12px] text-[#ccc] hover:bg-[#333]"
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
                        className="block w-full text-left px-3 py-1.5 text-[12px] text-[#ccc] hover:bg-[#333]"
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
        <div className="max-w-[88%] text-[15px] text-[#d4d4d4] leading-relaxed">
          {parsedContent}
          {item.partial && (
            <span className="inline-block w-1.5 h-[1.1em] bg-[#569cd6] animate-pulse ml-0.5 align-middle" />
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
          className="flex items-center gap-1.5 text-[13px] text-[#555] hover:text-[#888] transition-colors"
        >
          <span className={`transition-transform text-[10px] ${reasoningOpen ? 'rotate-90' : ''}`}>
            ▶
          </span>
          思考过程
        </button>
        {reasoningOpen && (
          <div className="mt-2 pl-3 border-l-2 border-[#2a2a2a] text-[13px] text-[#777] whitespace-pre-wrap leading-relaxed">
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
        <div className="mb-2 flex items-center gap-1.5 text-[13px] text-[#777]">
          <span className="font-mono text-[#dcdcaa]">{label}</span>
          <span className="text-[#666]">等待审批</span>
        </div>
      );
    }

    if (toolResult) {
      return <ToolSummary toolCall={item} toolResult={toolResult} />;
    }

    const isRejected = item.status === 'rejected';
    return (
      <div className="mb-2 flex items-center gap-1.5 text-[13px]">
        <span className={`font-mono ${isRejected ? 'text-[#666] line-through' : 'text-[#dcdcaa]'}`}>
          {item.name}
        </span>
        {item.status === 'running' && (
          <span className="text-[#569cd6] flex items-center gap-1">
            <span className="inline-block animate-spin">⟳</span> 执行中
          </span>
        )}
        {isRejected && <span className="text-[#666]">✗ 已拒绝</span>}
      </div>
    );
  }

  if (item.type === 'tool_result') {
    return null;
  }

  if (item.type === 'error') {
    return (
      <div className="mb-3 px-4 py-3 rounded-lg bg-[#2a1515] border border-[#5a2020] text-[#f47777] text-[14px] leading-relaxed">
        {item.message}
      </div>
    );
  }

  return null;
}
