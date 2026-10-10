import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Send,
  Square,
  ShieldCheck,
  Shield,
  FileText,
  Paperclip,
  X,
  GripVertical,
  Pencil,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore, type QueuedInput } from '../stores/agent.store';
import { useWorkspaceStore } from '../stores/workspace.store';
import {
  compactSession,
  setSessionModel,
  setSessionPermissionMode,
  setAgentConfig,
  stopAllSubagents,
  listSkills,
} from '../lib/core-api';
import MessageStream from './MessageStream';
import TodoPanel from './TodoPanel';
import ApprovalPanel from './ApprovalPanel';
import ProfileIndicator from './ProfileIndicator';
import PlanPanel from '../shared/PlanPanel';
import MediaView from '../shared/MediaView';
import { reachableMimes, attachmentHint, isLocalMedia, textOf, type ContentPart } from '@shared/parts';
import { MAX_MEDIA_BYTES, type PermissionMode } from '@codingcode/sdk';

/** 附件条上限：单文件字节上限用 sdk 的 `MAX_MEDIA_BYTES`，与服务端闸门同值，前端只做即时提示。 */
const MAX_ATTACHMENTS = 8;

interface Attachment {
  id: string;
  dataUrl: string;
  mimeType: string;
  filename: string;
}

function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11);
}

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

interface SkillOption {
  name: string;
  skillPath: string;
}

interface SkillRef {
  name: string;
  path: string;
}

function InputBox({
  centered,
  sendMessage,
  sendQueuedInput,
  abort,
  onOpenPlanPanel,
}: {
  centered?: boolean;
  sendMessage: (parts: ContentPart[], cwd?: string, skills?: SkillRef[]) => Promise<void>;
  sendQueuedInput: (threadId: string, item: QueuedInput) => Promise<void>;
  abort: () => void;
  onOpenPlanPanel?: () => void;
}) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  /** 当前模型的输入侧能力位：决定 accept 与附件按钮是否可用 */
  const caps = useAgentStore((s) => s.models.find((m) => m.id === s.model)?.capabilities);
  const accept = reachableMimes(caps).join(',');
  const capsHint = attachmentHint(caps);
  const attachDisabled = !!(caps && !caps.vision && !caps.audio);
  const isStreaming = useAgentStore((s) => {
    const tid = s.currentThreadId;
    if (!tid) return false;
    const thread = s.threads[tid];
    return thread?.turns.some((t) => t.status === 'running') ?? false;
  });
  const storePermissionMode = useAgentStore((s) => s.permissionMode);
  const setPermissionMode = useAgentStore((s) => s.setPermissionMode);
  const queueInput = useAgentStore((s) => s.queueInput);
  const removeQueuedInput = useAgentStore((s) => s.removeQueuedInput);
  const reorderQueuedInputs = useAgentStore((s) => s.reorderQueuedInputs);
  // useShallow：selector 在无队列 / 无会话时会返回新的 `[]` 字面量，
  // 默认的 Object.is 比较会让每次 render 都判定「值变了」→ 自激更新循环。
  // 浅比较按元素引用判等，彻底消除「新数组 identity」问题。
  const queuedInputs = useAgentStore(
    useShallow((s) =>
      s.currentThreadId ? (s.queuedInputsByThreadId[s.currentThreadId] ?? []) : []
    )
  );
  const workspace = useWorkspaceStore();
  const pendingInput = useAgentStore((s) => s.pendingInput);
  const setPendingInput = useAgentStore((s) => s.setPendingInput);
  const [stopMenuOpen, setStopMenuOpen] = useState(false);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const stopMenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (stopMenuOpen && stopButtonRef.current && stopMenuRef.current) {
      const rect = stopButtonRef.current.getBoundingClientRect();
      stopMenuRef.current.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      stopMenuRef.current.style.right = `${window.innerWidth - rect.right}px`;
    }
  }, [stopMenuOpen]);

  const [skillOptions, setSkillOptions] = useState<SkillOption[]>([]);
  const [skillMenu, setSkillMenu] = useState<{ query: string; start: number } | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const [pickedPaths, setPickedPaths] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!workspace.rootPath) return;
    listSkills(workspace.rootPath)
      .then((data) => setSkillOptions(data ?? []))
      .catch(() => setSkillOptions([]));
  }, [workspace.rootPath]);

  useLayoutEffect(() => {
    if (skillMenu && textareaRef.current && skillMenuRef.current) {
      const rect = textareaRef.current.getBoundingClientRect();
      skillMenuRef.current.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      skillMenuRef.current.style.left = `${rect.left + 12}px`;
    }
  }, [skillMenu, skillIndex]);

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

  const handleChange = (value: string, caret: number) => {
    setText(value);
    const m = value.slice(0, caret).match(/(?:^|\s)@([a-zA-Z0-9-]*)$/);
    if (m) {
      setSkillMenu({ query: m[1]!, start: caret - m[1]!.length - 1 });
      setSkillIndex(0);
    } else {
      setSkillMenu(null);
    }
  };

  const candidates = skillMenu
    ? skillOptions.filter((s) => s.name.startsWith(skillMenu.query))
    : [];

  const confirmSkill = (option: SkillOption) => {
    if (!skillMenu) return;
    const rest = text.slice(skillMenu.start + 1 + skillMenu.query.length);
    setText(`${text.slice(0, skillMenu.start)}@${option.name} ${rest}`);
    setPickedPaths((prev) => ({ ...prev, [option.name]: option.skillPath }));
    setSkillMenu(null);
    textareaRef.current?.focus();
  };

  /**
   * 粘贴、拖入、选文件共用同一条入口：先按当前模型可达格式筛一遍，被拒的
   * 就地提示、不入附件条。前端判定只是提示，最终准入在服务端（能力位 + 嗅探）。
   */
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const reachable = new Set(reachableMimes(caps));
      const room = MAX_ATTACHMENTS - attachments.length;
      const rejected: string[] = [];
      let overflow = 0;
      for (const f of Array.from(files)) {
        if (!reachable.has(f.type) || f.size > MAX_MEDIA_BYTES) {
          rejected.push(f.name || f.type || '未知文件');
          continue;
        }
        if (overflow >= room) {
          overflow += 1;
          continue;
        }
        overflow += 1;
        const reader = new FileReader();
        reader.onload = () =>
          setAttachments((prev) =>
            prev.length >= MAX_ATTACHMENTS
              ? prev
              : [
                  ...prev,
                  {
                    id: newId(),
                    dataUrl: String(reader.result),
                    mimeType: f.type,
                    filename: f.name,
                  },
                ]
          );
        reader.readAsDataURL(f);
      }
      if (rejected.length > 0) {
        setNotice(capsHint ?? `已忽略不支持的附件：${rejected.join('、')}`);
      } else if (overflow > 0) {
        setNotice(`一轮最多 ${MAX_ATTACHMENTS} 个附件`);
      } else {
        setNotice(null);
      }
    },
    [caps, capsHint, attachments.length]
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.items)
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length === 0) return;
      e.preventDefault();
      addFiles(files);
    },
    [addFiles]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    const skills: SkillRef[] = [];
    const seen = new Set<string>();
    for (const m of trimmed.matchAll(/@([a-zA-Z0-9-]+)/g)) {
      const name = m[1]!;
      if (seen.has(name)) continue;
      seen.add(name);
      const hits = skillOptions.filter((s) => s.name === name);
      // 下拉点选过就用那一条；手打则要求名字唯一，同名一律不下发
      const path = pickedPaths[name] ?? (hits.length === 1 ? hits[0]!.skillPath : undefined);
      if (path) skills.push({ name, path });
    }
    const parts: ContentPart[] = attachments.map((a) => ({
      type: 'media',
      dataUrl: a.dataUrl,
      mimeType: a.mimeType,
      filename: a.filename,
    }));
    parts.push({ type: 'text', text: trimmed });
    setText('');
    setAttachments([]);
    setNotice(null);
    setPickedPaths({});
    setSkillMenu(null);
    if (isStreaming) {
      // 活跃回合：只入前端队列，不发请求（等点击发送或回合结束后补发）
      const threadId = currentThreadId;
      if (threadId) queueInput(threadId, parts);
      return;
    }
    sendMessage(parts, workspace.rootPath || undefined, skills);
  }, [
    text,
    attachments,
    isStreaming,
    currentThreadId,
    queueInput,
    sendMessage,
    workspace.rootPath,
    pickedPaths,
    skillOptions,
  ]);

  /** 编辑队列项：文本回输入框、本地媒体回附件条、该项消失 */
  const editQueuedInput = useCallback(
    (item: QueuedInput) => {
      const threadId = currentThreadId;
      if (!threadId) return;
      const restoredAttachments: Attachment[] = [];
      for (const p of item.parts) {
        if (p.type === 'text') {
          setText((prev) => (prev ? `${prev}\n${p.text}` : p.text));
        } else if (isLocalMedia(p)) {
          restoredAttachments.push({
            id: newId(),
            dataUrl: p.dataUrl,
            mimeType: p.mimeType,
            filename: p.filename ?? 'attachment',
          });
        }
      }
      if (restoredAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...restoredAttachments]);
      }
      removeQueuedInput(threadId, item.id);
    },
    [currentThreadId, removeQueuedInput]
  );


  return (
    <div className={centered ? 'w-full max-w-[740px]' : 'px-5 pb-5 pt-2'}>
      {queuedInputs.length > 0 && currentThreadId && (
        <div className="mb-2 space-y-1.5" data-testid="queued-inputs">
          {queuedInputs.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2"
            >
              <GripVertical size={14} className="shrink-0 text-[var(--text-disabled)]" />
              <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{index + 1}</span>
              <span className="flex-1 truncate text-[13px] text-[var(--text-primary)]">
                {textOf(item.parts) || '（空）'}
              </span>
              <button
                type="button"
                data-testid={`queue-send-${item.id}`}
                disabled={item.status === 'sending'}
                onClick={() => void sendQueuedInput(currentThreadId, item)}
                aria-label="发送队列项"
                title="发送"
                className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                <Send size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => editQueuedInput(item)}
                aria-label="编辑队列项"
                title="编辑"
                className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Pencil size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => removeQueuedInput(currentThreadId, item.id)}
                aria-label="删除队列项"
                title="删除"
                className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[var(--accent-danger)] hover:bg-[var(--bg-hover)]"
              >
                <X size={13} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-2xl border bg-[var(--bg-card)] transition-colors shadow-xl overflow-hidden ${
          dragging
            ? 'border-[var(--accent-primary)]'
            : 'border-[var(--border-card)] hover:border-[var(--border-hover)] focus-within:border-[var(--accent-primary)]'
        }`}
      >
        {/* Row 0: 附件条 + 提示 */}
        {(attachments.length > 0 || notice) && (
          <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
            {attachments.map((a) => (
              <div key={a.id} className="relative group/att">
                <MediaView
                  compact
                  cwd={workspace.rootPath}
                  part={{
                    type: 'media',
                    dataUrl: a.dataUrl,
                    mimeType: a.mimeType,
                    filename: a.filename,
                  }}
                />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  aria-label={`移除附件 ${a.filename}`}
                  title="移除"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-[var(--bg-card)] border border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            {notice && <span className="text-[12px] text-[var(--accent-danger)]">{notice}</span>}
          </div>
        )}
        {/* Row 1: textarea + attach + send button side by side */}
        <div className="flex items-center gap-2 pr-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) =>
              handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (skillMenu && candidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSkillIndex((i) => (i + 1) % candidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSkillIndex((i) => (i - 1 + candidates.length) % candidates.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  confirmSkill(candidates[skillIndex]!);
                  return;
                }
                if (e.key === 'Escape') {
                  setSkillMenu(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="可向 AI 询问任何事"
            rows={3}
            className="flex-1 bg-transparent px-5 pt-4 pb-3 text-[15px] text-[var(--text-primary)] placeholder-[var(--text-disabled)] resize-none outline-none leading-relaxed disabled:opacity-50"
          />
          {/* 附件：选文件入口，accept 取当前模型可达格式 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={accept}
            data-testid="attach-input"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (attachDisabled) {
                setNotice(capsHint);
                return;
              }
              fileInputRef.current?.click();
            }}
            aria-label="添加图片、音频或 PDF"
            title={capsHint ?? '添加图片、音频或 PDF'}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-[var(--text-placeholder)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-colors"
          >
            <Paperclip size={16} strokeWidth={1.8} />
          </button>
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
              disabled={!text.trim() && attachments.length === 0}
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
        {/* @ 的 skill 候选：portal 到 body，避免被上面容器的 overflow-hidden 裁剪 */}
        {skillMenu && candidates.length > 0 &&
          createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSkillMenu(null)} />
              <div
                ref={skillMenuRef}
                className="fixed z-50 min-w-[280px] max-h-[240px] overflow-y-auto py-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-base)] shadow-lg"
              >
                {candidates.map((option, i) => (
                  <button
                    key={option.skillPath}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      confirmSkill(option);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                      i === skillIndex
                        ? 'bg-[var(--bg-selected-hover)] text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="truncate">{option.name}</div>
                    <div className="truncate text-[11px] text-[var(--text-disabled)]">
                      {option.skillPath}
                    </div>
                  </button>
                ))}
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
  sendMessage: (parts: ContentPart[], cwd?: string, skills?: SkillRef[]) => Promise<void>;
  sendQueuedInput: (threadId: string, item: QueuedInput) => Promise<void>;
  abort: () => void;
}

export default function AgentWorkspace({ sendMessage, sendQueuedInput, abort }: AgentWorkspaceProps) {
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
        <InputBox centered sendMessage={sendMessage} sendQueuedInput={sendQueuedInput} abort={abort} />
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
            sendQueuedInput={sendQueuedInput}
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
