import { useEffect, useState, useRef, useCallback } from 'react';
import { X, Check, Pencil, Ban, ClipboardCopy } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

export interface PlanApprovalModalProps {
  /** Plan content (Markdown) submitted by the agent. */
  planContent: string;
  /** Path to the persisted plan file, displayed as a reference. */
  planPath?: string;
  /** Optional session id (for showing in title only). */
  sessionId?: string;
  /**
   * Called when the user picks a final action. The parent is responsible for
   * sending the corresponding JSON envelope to the server.
   */
  onImplement: () => void;
  onModify: (newContent: string) => void;
  onCancel: () => void;
}

type View = 'preview' | 'edit';

/**
 * Three-option plan approval modal triggered when submit_plan asks for user
 * confirmation. The plan content is rendered as Markdown by default; the user
 * can switch to an edit view to revise it before sending the "modify" choice
 * back to the model.
 */
export default function PlanApprovalModal({
  planContent,
  planPath,
  sessionId,
  onImplement,
  onModify,
  onCancel,
}: PlanApprovalModalProps) {
  const [view, setView] = useState<View>('preview');
  const [draft, setDraft] = useState<string>(planContent);
  const [submitting, setSubmitting] = useState<null | 'implement' | 'modify' | 'cancel'>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { copiedId, copy } = useCopyToClipboard();

  // Keep the draft in sync if a new plan arrives while the modal is open
  useEffect(() => {
    setDraft(planContent);
  }, [planContent]);

  useEffect(() => {
    if (view === 'edit') {
      // Focus the editor on entry
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [view]);

  // ESC cancels (matches the "Cancel" button)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (submitting) return;
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel, submitting]);

  const handleImplement = useCallback(() => {
    if (submitting) return;
    setSubmitting('implement');
    onImplement();
  }, [onImplement, submitting]);

  const handleModify = useCallback(() => {
    if (submitting) return;
    if (draft.trim() === planContent.trim()) {
      // No changes — treat as implement
      setSubmitting('implement');
      onImplement();
      return;
    }
    setSubmitting('modify');
    onModify(draft);
  }, [draft, planContent, onImplement, onModify, submitting]);

  const handleCancel = useCallback(() => {
    if (submitting) return;
    setSubmitting('cancel');
    onCancel();
  }, [onCancel, submitting]);

  const planLines = planContent.split('\n').length;
  const planChars = planContent.length;
  const planPathLabel = planPath ?? '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Plan approval"
      data-testid="plan-approval-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-bg)] p-4"
    >
      <div
        className="flex flex-col bg-[var(--bg-panel)] border border-[var(--border-strong)] rounded-xl shadow-2xl w-full max-w-[820px] max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border-card)] bg-[var(--bg-code-header)]">
          <span className="text-[15px] font-medium text-[var(--text-primary)]">📋 计划审批</span>
          {sessionId && (
            <span className="text-[11px] text-[var(--text-muted)] ml-1">
              会话 {sessionId.slice(0, 8)}
            </span>
          )}
          <span className="ml-auto text-[12px] text-[var(--text-muted)]">
            {planLines} 行 · {planChars} 字符
          </span>
          <button
            type="button"
            onClick={handleCancel}
            disabled={!!submitting}
            aria-label="关闭"
            title="关闭（Esc）"
            className="ml-2 w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors disabled:opacity-50"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Plan meta */}
        {planPathLabel && (
          <div className="px-5 py-1.5 text-[11px] text-[var(--text-muted)] border-b border-[var(--border-card)] truncate" title={planPathLabel}>
            计划文件：{planPathLabel}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pt-2 border-b border-[var(--border-card)]">
          <button
            type="button"
            onClick={() => setView('preview')}
            className={`px-3 py-1.5 text-[13px] rounded-t-md transition-colors ${
              view === 'preview'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] border-b-2 border-[var(--accent-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            预览
          </button>
          <button
            type="button"
            onClick={() => setView('edit')}
            className={`px-3 py-1.5 text-[13px] rounded-t-md transition-colors ${
              view === 'edit'
                ? 'bg-[var(--bg-card)] text-[var(--text-primary)] border-b-2 border-[var(--accent-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            修改
          </button>
          <button
            type="button"
            onClick={() => copy(planContent, 'plan-modal')}
            className="ml-auto mb-1 flex items-center gap-1 px-2 py-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
            title="复制计划内容"
          >
            <ClipboardCopy size={12} strokeWidth={1.5} />
            {copiedId === 'plan-modal' ? '已复制' : '复制'}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-card)]">
          {view === 'preview' ? (
            <div className="px-6 py-4">
              {planContent ? (
                <MarkdownRenderer content={planContent} />
              ) : (
                <div className="text-[var(--text-muted)] text-[14px]">（计划内容为空）</div>
              )}
            </div>
          ) : (
            <div className="px-4 py-3 h-full flex flex-col">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="flex-1 min-h-[280px] w-full px-3 py-2 text-[13px] font-mono leading-relaxed bg-[var(--bg-input)] border border-[var(--border-card)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] resize-none"
                placeholder="在此修改计划 Markdown..."
              />
              <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                修改后点击「提出修改意见」，模型将根据修订内容重写计划。
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border-card)] bg-[var(--bg-code-header)]">
          <button
            type="button"
            onClick={handleCancel}
            disabled={!!submitting}
            data-testid="plan-cancel"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[var(--text-primary)] bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] rounded transition-colors disabled:opacity-50"
          >
            <Ban size={14} strokeWidth={1.5} /> 取消执行
          </button>
          <button
            type="button"
            onClick={() => {
              setView('edit');
            }}
            disabled={!!submitting}
            data-testid="plan-modify-tab"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[var(--text-primary)] bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] rounded transition-colors disabled:opacity-50"
          >
            <Pencil size={14} strokeWidth={1.5} /> 提出修改
          </button>
          <div className="ml-auto flex items-center gap-2">
            {view === 'edit' && (
              <button
                type="button"
                onClick={handleModify}
                disabled={!!submitting}
                data-testid="plan-modify-submit"
                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[var(--text-inverse)] bg-[var(--accent-primary)] hover:opacity-80 rounded transition-colors disabled:opacity-50"
              >
                <Pencil size={14} strokeWidth={1.5} /> 提交修改
              </button>
            )}
            <button
              type="button"
              onClick={handleImplement}
              disabled={!!submitting}
              data-testid="plan-implement"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[var(--text-inverse)] bg-[var(--accent-success)] hover:opacity-80 rounded transition-colors disabled:opacity-50"
            >
              <Check size={14} strokeWidth={1.5} /> 直接实现
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
