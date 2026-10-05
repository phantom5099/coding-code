import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Send, Square, ShieldCheck, Shield, FileText } from 'lucide-react';
import { useAgentStore } from '../stores/agent.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import {
  compactSession,
  setSessionModel,
  setSessionPermissionMode,
  setAgentConfig,
  stopAllSubagents,
} from '../lib/core-api';
import MessageStream from './MessageStream';
import TodoPanel from './TodoPanel';
import ApprovalPanel from './ApprovalPanel';
import ProfileIndicator from './ProfileIndicator';
import PlanPanel from '../shared/PlanPanel';
import type { PermissionMode } from '@codingcode/sdk';

const MODE_LABELS: Record<PermissionMode, string> = {
  askBeforeExec: '执行前询问',
  bypass: '完全放行',
};

const MODE_NEXT: Record<PermissionMode, PermissionMode> = {
  askBeforeExec: 'bypass',
  bypass: 'askBeforeExec',
};

const MODE_ICONS: Record<PermissionMode, React.ReactNode> = {
  askBeforeExec: <ShieldCheck size={14} strokeWidth={1.5} />,
  bypass: <Shield size={14} strokeWidth={1.5} />,
};

// ─── ContextIndicator ──────────────────────────────────────────────────────

function ContextIndicator({ threadId }: { threadId: string }) {
  const contextUsage = useAgentStore((s) => s.contextUsage);
  const usage = useAgentStore((s) => s.usageByThreadId[threadId]);
  const setContextUsage = useAgentStore((s) => s.setContextUsage);
  const clearThreadUsage = useAgentStore((s) => s.clearThreadUsage);
  const isCompressing = useAgentStore((s) => s.isCompressing);
  const startCompressing = useAgentStore((s) => s.startCompressing);
  const stopCompressing = useAgentStore((s) => s.stopCompressing);
  const model = useAgentStore((s) => s.model);

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
          const res = await compactSession(threadId, '', model);
          if (res.didCompress && contextUsage) {
            setContextUsage({
              used: res.promptEstimate,
              contextWindow: contextUsage.contextWindow,
            });
            clearThreadUsage(threadId);
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
  const model = useAgentStore((s) => s.model);
  const models = useAgentStore((s) => s.models);
  const selectModel = useAgentStore((s) => s.selectModel);
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
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
                        selectModel(m.id);
                        setOpen(false);
                        await setSessionModel(currentThreadId, rootPath ?? '', m.id).catch((e) => {
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
  onOpenPlanPanel,
}: {
  centered?: boolean;
  sendMessage: (content: string, cwd?: string) => Promise<void>;
  abort: () => void;
  onOpenPlanPanel?: () => void;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const isStreaming = useAgentStore((s) => {
    const tid = s.currentThreadId;
    if (!tid) return false;
    const thread = s.threads[tid];
    return thread?.turns.some((t) => t.status === 'running') ?? false;
  });
  const storePermissionMode = useAgentStore((s) => s.permissionMode);
  const setPermissionMode = useAgentStore((s) => s.setPermissionMode);
  const workspace = useWorkspaceStore();
  const pendingInput = useAgentStore((s) => s.pendingInput);
  const setPendingInput = useAgentStore((s) => s.setPendingInput);
  const [stopMenuOpen, setStopMenuOpen] = useState(false);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const stopMenuRef = useRef<HTMLDivElement>(null);

  // 输入框容器带 overflow-hidden（裁圆角），绝对定位的下拉会被裁掉。
  // 与 ModelSelector 同法：portal 到 body + fixed 定位，绕开祖先裁剪。
  useLayoutEffect(() => {
    if (stopMenuOpen && stopButtonRef.current && stopMenuRef.current) {
      const rect = stopButtonRef.current.getBoundingClientRect();
      stopMenuRef.current.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      stopMenuRef.current.style.right = `${window.innerWidth - rect.right}px`;
    }
  }, [stopMenuOpen]);

  /** 「停止全部」：先让服务端 abort 所有后台子代理，再停掉当前这条流 */
  const handleStopAll = useCallback(async () => {
    setStopMenuOpen(false);
    const threadId = currentThreadId;
    if (threadId) {
      try {
        await stopAllSubagents(threadId);
      } catch (e) {
        console.error('Failed to stop subagents:', e);
      }
    }
    abort();
  }, [currentThreadId, abort]);

  // 有会话时显示该会话真实的权限模式；还没有会话时显示 config.yaml 里的值
  const sessionPermissionMode = useAgentStore((s) =>
    s.currentThreadId ? (s.profileByThreadId[s.currentThreadId]?.permissionMode ?? null) : null
  );
  const permissionMode: PermissionMode = sessionPermissionMode ?? storePermissionMode;

  const isPlanProfile = useAgentStore((s) => {
    if (!s.currentThreadId) {
      return s.profile === 'plan';
    }
    return s.profileByThreadId[s.currentThreadId]?.activeProfile === 'plan';
  });
  const planExists = useAgentStore((s) => {
    if (!s.currentThreadId) return false;
    return s.pendingPlanByThreadId[s.currentThreadId] != null;
  });

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
            <div className="shrink-0">
              <button
                ref={stopButtonRef}
                type="button"
                onClick={() => setStopMenuOpen((v) => !v)}
                aria-label="停止生成"
                title="停止生成"
                className="w-9 h-9 flex items-center justify-center bg-[var(--border-hover)] hover:bg-[var(--border-strong)] text-[var(--text-primary)] rounded-full transition-colors"
              >
                <Square size={14} strokeWidth={2} fill="currentColor" />
              </button>
            </div>
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
        {/* 停止菜单：portal 到 body，避免被上面容器的 overflow-hidden 裁剪 */}
        {stopMenuOpen &&
          createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={() => setStopMenuOpen(false)} />
              <div
                ref={stopMenuRef}
                className="fixed z-50 w-36 py-1 rounded-md border border-[var(--text-disabled)] bg-[var(--bg-base)] shadow-lg"
              >
                <button
                  type="button"
                  data-testid="stop-current"
                  onClick={() => {
                    setStopMenuOpen(false);
                    abort();
                  }}
                  className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
                >
                  停止当前生成
                </button>
                <button
                  type="button"
                  data-testid="stop-all"
                  onClick={handleStopAll}
                  className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border-strong)]"
                >
                  停止全部
                </button>
              </div>
            </>,
            document.body
          )}
        {/* Row 2: toolbar */}
        <div className="flex items-center gap-2 px-3 pb-3 pt-0">
          {!isPlanProfile && (
            <button
              type="button"
              onClick={() => {
                const next = MODE_NEXT[permissionMode];
                if (currentThreadId) {
                  const entry = useAgentStore.getState().profileByThreadId[currentThreadId];
                  useAgentStore.getState().setProfileForThread(currentThreadId, {
                    activeProfile: entry?.activeProfile ?? 'build',
                    permissionMode: next,
                  });
                  setSessionPermissionMode(currentThreadId, workspace.rootPath || '', next).catch(
                    (e) => {
                      console.error('Failed to sync permission mode:', e);
                    }
                  );
                } else {
                  setAgentConfig({ permissionMode: next })
                    .then((cfg) => setPermissionMode(cfg.permissionMode))
                    .catch((e) => {
                      console.error('Failed to save default permission mode:', e);
                    });
                }
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] text-[var(--text-placeholder)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
            >
              <span className="text-[var(--accent-primary)]">{MODE_ICONS[permissionMode]}</span>
              <span>{MODE_LABELS[permissionMode]}</span>
              <span className="text-[var(--text-disabled)] text-[10px]">▾</span>
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {planExists && onOpenPlanPanel && (
              <button
                type="button"
                onClick={onOpenPlanPanel}
                data-testid="view-plan-button"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] text-[var(--text-placeholder)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                title="查看当前 plan 详情"
              >
                <FileText size={14} strokeWidth={1.5} />
                <span>查看计划</span>
              </button>
            )}
            <ProfileIndicator sessionId={currentThreadId} cwd={workspace.rootPath} />
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
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const isCompressing = useAgentStore((s) => s.isCompressing);
  const workspace = useWorkspaceStore();
  const [planPanelOpen, setPlanPanelOpen] = useState(false);

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
    <div className="flex-1 flex flex-row overflow-hidden bg-[var(--bg-panel)] min-w-0">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <MessageStream key={currentThreadId} threadId={currentThreadId} />
        <ApprovalPanel threadId={currentThreadId} />
        <TodoPanel threadId={currentThreadId} />
        {isCompressing && (
          <div className="shrink-0 px-5 py-1.5 bg-[var(--bg-card)] border-t border-[var(--border-card)] flex items-center gap-2 text-[13px] text-[var(--text-tertiary)]">
            <span className="w-3 h-3 border-2 border-[var(--text-placeholder)] border-t-transparent rounded-full animate-spin" />
            <span>正在压缩上下文...</span>
          </div>
        )}
        <div className="shrink-0">
          <InputBox
            sendMessage={sendMessage}
            abort={abort}
            onOpenPlanPanel={() => setPlanPanelOpen(true)}
          />
        </div>
      </div>
      {planPanelOpen && (
        <PlanPanel
          sessionId={currentThreadId}
          cwd={workspace.rootPath}
          onClose={() => setPlanPanelOpen(false)}
        />
      )}
    </div>
  );
}
