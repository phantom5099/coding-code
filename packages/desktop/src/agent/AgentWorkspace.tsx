import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Send, Square, ShieldAlert, ShieldCheck, Shield, Eye } from 'lucide-react';
import { useGlobalStore } from '../stores/global.store';
import { API_BASE, api } from '../lib/api';
import { setSessionPermissionMode } from '../lib/core-api';
import MessageStream from './MessageStream';
import TodoPanel from './TodoPanel';
import ApprovalPanel from './ApprovalPanel';

// ─── ContextIndicator ──────────────────────────────────────────────────────

function ContextIndicator({ threadId }: { threadId: string }) {
  const contextUsage = useGlobalStore((s) => s.agent.contextUsage);
  const usage = useGlobalStore((s) => s.agent.usageByThreadId[threadId]);
  const setContextUsage = useGlobalStore((s) => s.setContextUsage);
  const isCompressing = useGlobalStore((s) => s.agent.isCompressing);
  const startCompressing = useGlobalStore((s) => s.startCompressing);
  const stopCompressing = useGlobalStore((s) => s.stopCompressing);

  const r = 7;
  const circ = 2 * Math.PI * r;

  if (isCompressing) {
    return (
      <button
        type="button"
        disabled
        aria-label="正在压缩上下文"
        className="w-5 h-5 flex items-center justify-center animate-pulse cursor-default"
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border-card)" strokeWidth="2.5" />
          <circle
            cx="9"
            cy="9"
            r={r}
            fill="none"
            stroke="var(--text-placeholder)"
            strokeWidth="2.5"
            strokeDasharray={circ}
            strokeDashoffset={circ * 0.6}
            strokeLinecap="round"
            transform="rotate(-90 9 9)"
          />
        </svg>
      </button>
    );
  }

  if (!contextUsage) return null;
  // When LLM only returns total (no prompt/completion split), fall back to total for both pct and detail
  const effectiveUsed =
    usage && usage.prompt === 0 && usage.completion === 0 ? usage.total : contextUsage.used;
  const pct = Math.min(effectiveUsed / contextUsage.contextWindow, 1);
  const color = pct < 0.4 ? '#4ec9b0' : pct < 0.75 ? '#e5c07b' : '#f44747';
  const detail = usage
    ? usage.prompt === 0 && usage.completion === 0
      ? `${usage.total.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens`
      : `prompt: ${usage.prompt.toLocaleString()}, completion: ${usage.completion.toLocaleString()}, total: ${usage.total.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens`
    : `${contextUsage.used.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens`;
  return (
    <button
      type="button"
      onClick={async () => {
        startCompressing();
        try {
          const res = await api<{ promptEstimate: number; didCompress: boolean; released: number }>(
            `/api/sessions/${threadId}/compact`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cwd: '' }),
            }
          );
          if (res.promptEstimate != null && contextUsage) {
            setContextUsage({
              used: res.promptEstimate,
              contextWindow: contextUsage.contextWindow,
            });
          }
        } catch (e) {
          console.error('Failed to compact session:', e);
        } finally {
          stopCompressing();
        }
      }}
      title={`上下文: ${Math.round(pct * 100)}% (${detail})\n点击压缩`}
      className="w-5 h-5 flex items-center justify-center hover:opacity-70 transition-opacity"
    >
      <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r={r} fill="none" stroke="var(--border-card)" strokeWidth="2.5" />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 9 9)"
        />
      </svg>
    </button>
  );
}

// ─── ModelSelector ─────────────────────────────────────────────────────────

function ModelSelector() {
  const model = useGlobalStore((s) => s.agent.model);
  const models = useGlobalStore((s) => s.agent.models);
  const setModel = useGlobalStore((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const groups = models.reduce<Record<string, typeof models>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider]!.push(m);
    return acc;
  }, {});

  const currentModel = models.find((m) => m.id === model);
  const displayName = currentModel?.name ?? (model ? model.split('-').slice(-2).join(' ') : '');

  useLayoutEffect(() => {
    if (open && dropdownRef.current && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      dropdownRef.current.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      dropdownRef.current.style.right = `${window.innerWidth - rect.right}px`;
    }
  }, [open]);

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] text-[var(--text-placeholder)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
      >
        <span className="max-w-[160px] truncate">{displayName || '选择模型'}</span>
        <span className="text-[var(--text-disabled)] text-[10px]">▾</span>
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              ref={dropdownRef}
              className="fixed bg-[var(--bg-tooltip)] border border-[var(--border-strong)] rounded-xl shadow-2xl min-w-[260px] z-50 py-1.5 max-h-[400px] overflow-y-auto"
            >
              {Object.entries(groups).map(([provider, providerModels]) => (
                <div key={provider}>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--text-disabled)] uppercase tracking-wider">
                    {provider}
                  </div>
                  {providerModels.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      onClick={async () => {
                        setModel(m.id);
                        setOpen(false);
                        await api(`/api/models/switch`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ modelId: m.id }),
                        }).catch((e) => {
                          console.error('Failed to switch model:', e);
                        });
                      }}
                      className={`w-full text-left px-3 py-2 text-[14px] hover:bg-[var(--bg-selected-hover)] transition-colors flex items-center gap-2 ${m.id === model ? 'text-[var(--accent-success)]' : 'text-[var(--text-primary)]'}`}
                    >
                      <span className="w-4 shrink-0 text-center text-[12px]">
                        {m.id === model ? '✓' : ''}
                      </span>
                      <span className="flex-1">{m.name}</span>
                      <span className="text-[var(--text-disabled)] text-[12px] shrink-0">
                        {(m.context_window / 1000).toFixed(0)}k
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {models.length === 0 && (
                <div className="px-3 py-3 text-[14px] text-[var(--text-disabled)]">无可用模型</div>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

// ─── InputBox ──────────────────────────────────────────────────────────────

function InputBox({
  centered,
  sendMessage,
  abort,
}: {
  centered?: boolean;
  sendMessage: (content: string, cwd?: string) => Promise<void>;
  abort: () => void;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId);
  const isStreaming = useGlobalStore((s) => {
    const tid = s.agent.currentThreadId;
    if (!tid) return false;
    const thread = s.agent.threads[tid];
    return thread?.turns.some((t) => t.status === 'running') ?? false;
  });
  const approvalPolicy = useGlobalStore((s) => s.agent.approvalPolicy);
  const workspace = useGlobalStore((s) => s.workspace);
  const setApprovalPolicy = useGlobalStore((s) => s.setApprovalPolicy);
  const pendingInput = useGlobalStore((s) => s.agent.pendingInput);
  const setPendingInput = useGlobalStore((s) => s.setPendingInput);

  // Consume pendingInput when it's set
  useEffect(() => {
    if (pendingInput !== null) {
      setText(pendingInput);
      setPendingInput(null);
      // Focus textarea after setting text
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [pendingInput, setPendingInput]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setText('');
    sendMessage(trimmed, workspace.rootPath || undefined);
  }, [text, isStreaming, sendMessage, workspace.rootPath]);

  const POLICY_LABELS: Record<string, string> = {
    'ask-all': '全部询问',
    'smart-allow': '半自动',
    'full-allow': '完全放行',
    'read-only': '只读模式',
  };
  const POLICY_NEXT: Record<string, 'ask-all' | 'smart-allow' | 'full-allow' | 'read-only'> = {
    'ask-all': 'smart-allow',
    'smart-allow': 'full-allow',
    'full-allow': 'read-only',
    'read-only': 'ask-all',
  };
  const POLICY_ICONS: Record<string, React.ReactNode> = {
    'ask-all': <ShieldAlert size={14} strokeWidth={1.5} />,
    'smart-allow': <ShieldCheck size={14} strokeWidth={1.5} />,
    'full-allow': <Shield size={14} strokeWidth={1.5} />,
    'read-only': <Eye size={14} strokeWidth={1.5} />,
  };

  return (
    <div className={centered ? 'w-full max-w-[740px]' : 'px-5 pb-5 pt-2'}>
      <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] hover:border-[var(--border-hover)] focus-within:border-[var(--accent-primary)] transition-colors shadow-xl overflow-hidden">
        {/* Row 1: textarea + send button side by side */}
        <div className="flex items-center gap-2 pr-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="可向 AI 询问任何事"
            disabled={isStreaming}
            rows={3}
            className="flex-1 bg-transparent px-5 pt-4 pb-3 text-[15px] text-[var(--text-primary)] placeholder-[var(--text-disabled)] resize-none outline-none leading-relaxed disabled:opacity-50"
          />
          {/* Send / Stop — vertically centered to the right of textarea */}
          {isStreaming ? (
            <button
              type="button"
              onClick={() => abort()}
              aria-label="停止生成"
              title="停止生成"
              className="w-9 h-9 shrink-0 flex items-center justify-center bg-[var(--border-hover)] hover:bg-[var(--border-strong)] text-[var(--text-primary)] rounded-full transition-colors"
            >
              <Square size={14} strokeWidth={2} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!text.trim()}
              aria-label="发送消息"
              title="发送消息"
              className="w-9 h-9 shrink-0 flex items-center justify-center bg-[var(--btn-send-bg)] disabled:bg-[var(--bg-card)] disabled:text-[var(--text-disabled)] text-[var(--text-inverse)] rounded-full transition-colors"
            >
              <Send size={18} strokeWidth={2} />
            </button>
          )}
        </div>
        {/* Row 2: toolbar */}
        <div className="flex items-center gap-2 px-3 pb-3 pt-0">
          <button
            type="button"
            onClick={() => {
              const next = POLICY_NEXT[approvalPolicy] ?? 'ask-all';
              setApprovalPolicy(next);
              if (currentThreadId) {
                const POLICY_TO_CORE_MODE: Record<string, string> = {
                  'ask-all': 'default',
                  'smart-allow': 'acceptEdits',
                  'full-allow': 'bypass',
                  'read-only': 'plan',
                };
                setSessionPermissionMode(
                  currentThreadId,
                  POLICY_TO_CORE_MODE[next] ?? 'default'
                ).catch((e) => {
                  console.error('Failed to sync permission mode:', e);
                });
              }
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] text-[var(--text-placeholder)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
          >
            <span className="text-[var(--accent-primary)]">{POLICY_ICONS[approvalPolicy]}</span>
            <span>{POLICY_LABELS[approvalPolicy] ?? '全部询问'}</span>
            <span className="text-[var(--text-disabled)] text-[10px]">▾</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            {currentThreadId && <ContextIndicator threadId={currentThreadId} />}
            <ModelSelector />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AgentWorkspace ────────────────────────────────────────────────────────

interface AgentWorkspaceProps {
  sendMessage: (content: string, cwd?: string) => Promise<void>;
  abort: () => void;
}

export default function AgentWorkspace({ sendMessage, abort }: AgentWorkspaceProps) {
  const currentThreadId = useGlobalStore((s) => s.agent.currentThreadId);
  const isCompressing = useGlobalStore((s) => s.agent.isCompressing);
  const workspace = useGlobalStore((s) => s.workspace);

  if (!currentThreadId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-[var(--bg-panel)] overflow-hidden px-6">
        <h2 className="text-[22px] font-medium text-[var(--text-primary)] tracking-tight">
          在{' '}
          <span className="text-[var(--accent-primary)] font-semibold">
            {workspace.name || workspace.rootPath.split(/[\\/]/).pop() || '当前目录'}
          </span>{' '}
          中构建什么？
        </h2>
        <InputBox centered sendMessage={sendMessage} abort={abort} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-panel)]">
      <MessageStream threadId={currentThreadId} />
      <ApprovalPanel threadId={currentThreadId} />
      <TodoPanel threadId={currentThreadId} />
      {isCompressing && (
        <div className="shrink-0 px-5 py-1.5 bg-[var(--bg-card)] border-t border-[var(--border-card)] flex items-center gap-2 text-[13px] text-[var(--text-tertiary)]">
          <span className="w-3 h-3 border-2 border-[var(--text-placeholder)] border-t-transparent rounded-full animate-spin" />
          <span>正在压缩上下文...</span>
        </div>
      )}
      <div className="shrink-0">
        <InputBox sendMessage={sendMessage} abort={abort} />
      </div>
    </div>
  );
}
