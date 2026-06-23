import { useEffect, useState, useCallback } from 'react';
import { X, RefreshCw, FileText, AlertCircle } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { useAgentMode, type PlanFileSnapshot } from '../hooks/useAgent';

interface PlanPanelProps {
  sessionId: string;
  cwd: string;
  onClose: () => void;
}

/**
 * Side drawer that renders the persisted plan file for the current session.
 * The plan is stored on disk by the server's submit_plan tool, so this panel
 * is purely a viewer — it never writes back.
 */
export default function PlanPanel({ sessionId, cwd, onClose }: PlanPanelProps) {
  const { fetchPlan } = useAgentMode();
  const [plan, setPlan] = useState<PlanFileSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPlan(sessionId, cwd);
      setPlan(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchPlan, sessionId, cwd]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ESC closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <aside
      role="complementary"
      aria-label="Plan viewer"
      data-testid="plan-panel"
      className="w-[420px] shrink-0 h-full flex flex-col bg-[var(--bg-panel)] border-l border-[var(--border-default)]"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-card)] bg-[var(--bg-code-header)]">
        <FileText size={15} strokeWidth={1.5} className="text-[var(--text-muted)]" />
        <span className="text-[14px] font-medium text-[var(--text-primary)]">当前计划</span>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          title="刷新"
          aria-label="刷新计划"
          className="ml-1 w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭计划面板"
          title="关闭"
          className="ml-auto w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors"
        >
          <X size={15} strokeWidth={1.5} />
        </button>
      </div>
      {plan?.path && (
        <div className="px-4 py-1.5 text-[11px] text-[var(--text-muted)] border-b border-[var(--border-card)] truncate" title={plan.path}>
          {plan.path}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-[var(--text-muted)]">
            <span className="inline-block w-3 h-3 border-2 border-[var(--text-placeholder)] border-t-transparent rounded-full animate-spin" />
            加载中…
          </div>
        )}
        {error && !loading && (
          <div className="m-4 p-3 rounded border border-[var(--accent-danger-border)] bg-[var(--accent-danger-bg)] text-[13px] text-[var(--accent-danger)]">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertCircle size={14} strokeWidth={1.5} />
              <span className="font-medium">加载失败</span>
            </div>
            <div className="text-[12px] text-[var(--text-tertiary)]">{error}</div>
          </div>
        )}
        {!loading && !error && plan && !plan.exists && (
          <div className="px-6 py-8 text-center text-[13px] text-[var(--text-muted)]">
            暂无计划。在 Plan 模式下让模型生成计划并通过 submit_plan 提交后，会自动保存到：
            <div className="mt-2 px-3 py-1.5 text-[12px] font-mono text-[var(--text-placeholder)] bg-[var(--bg-input)] border border-[var(--border-card)] rounded inline-block break-all">
              {plan.directory}
            </div>
          </div>
        )}
        {!loading && !error && plan?.exists && (
          <div className="px-5 py-3">
            <MarkdownRenderer content={plan.content} />
          </div>
        )}
      </div>
    </aside>
  );
}
