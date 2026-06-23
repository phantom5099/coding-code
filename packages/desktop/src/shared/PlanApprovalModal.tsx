import { useState, useCallback } from 'react';
import { X, Check, Pencil, Ban } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

export interface PlanApprovalModalProps {
  planContent: string;
  planPath?: string;
  sessionId?: string;
  loading?: boolean;
  onImplement: () => void;
  onSubmitOpinion: (opinion: string) => void;
  onCancel: () => void;
}

type Submitting = null | 'implement' | 'opinion' | 'cancel';

export default function PlanApprovalModal({
  planContent,
  planPath,
  sessionId,
  loading,
  onImplement,
  onSubmitOpinion,
  onCancel,
}: PlanApprovalModalProps) {
  const [opinion, setOpinion] = useState('');
  const [submitting, setSubmitting] = useState<Submitting>(null);

  const opinionEmpty = opinion.trim() === '';

  const handleImplement = useCallback(() => {
    if (submitting) return;
    setSubmitting('implement');
    onImplement();
  }, [onImplement, submitting]);

  const handleSubmitOpinion = useCallback(() => {
    if (submitting || opinionEmpty) return;
    setSubmitting('opinion');
    onSubmitOpinion(opinion);
  }, [onSubmitOpinion, opinion, opinionEmpty, submitting]);

  const handleCancel = useCallback(() => {
    if (submitting) return;
    setSubmitting('cancel');
    onCancel();
  }, [onCancel, submitting]);

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
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border-card)] bg-[var(--bg-code-header)]">
          <span className="text-[15px] font-medium text-[var(--text-primary)]">计划审批</span>
          {sessionId && (
            <span className="text-[11px] text-[var(--text-muted)] ml-1">
              会话 {sessionId.slice(0, 8)}
            </span>
          )}
          <button
            type="button"
            onClick={handleCancel}
            disabled={!!submitting}
            aria-label="关闭"
            title="关闭"
            className="ml-auto w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors disabled:opacity-50"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {planPathLabel && (
          <div
            className="px-5 py-1.5 text-[11px] text-[var(--text-muted)] border-b border-[var(--border-card)] truncate"
            title={planPathLabel}
          >
            计划文件：{planPathLabel}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--bg-card)] px-6 py-4">
          {loading ? (
            <div className="text-[var(--text-muted)] text-[14px]">加载中…</div>
          ) : planContent ? (
            <MarkdownRenderer content={planContent} />
          ) : (
            <div className="text-[var(--text-muted)] text-[14px]">（计划内容为空）</div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--border-card)] bg-[var(--bg-code-header)]">
          <textarea
            value={opinion}
            onChange={(e) => setOpinion(e.target.value)}
            placeholder="在此输入你对方案的修改意见（可选，留空则只能选择「执行」或「取消」）"
            disabled={!!submitting}
            spellCheck={false}
            className="w-full px-3 py-2 text-[13px] font-mono leading-relaxed bg-[var(--bg-input)] border border-[var(--border-card)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] resize-none disabled:opacity-50"
            rows={3}
            data-testid="plan-opinion-input"
          />
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border-card)] bg-[var(--bg-code-header)]">
          <button
            type="button"
            onClick={handleCancel}
            disabled={!!submitting}
            data-testid="plan-cancel"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[var(--text-primary)] bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] rounded transition-colors disabled:opacity-50"
          >
            <Ban size={14} strokeWidth={1.5} /> 取消
          </button>
          <button
            type="button"
            onClick={handleSubmitOpinion}
            disabled={!!submitting || opinionEmpty}
            data-testid="plan-submit-opinion"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[var(--text-inverse)] bg-[var(--accent-primary)] hover:opacity-80 rounded transition-colors disabled:opacity-50"
          >
            <Pencil size={14} strokeWidth={1.5} /> 提交意见
          </button>
          <button
            type="button"
            onClick={handleImplement}
            disabled={!!submitting}
            data-testid="plan-implement"
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-[var(--text-inverse)] bg-[var(--accent-success)] hover:opacity-80 rounded transition-colors disabled:opacity-50"
          >
            <Check size={14} strokeWidth={1.5} /> 执行
          </button>
        </div>
      </div>
    </div>
  );
}
