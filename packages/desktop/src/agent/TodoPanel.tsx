import { useGlobalStore } from '../stores/global.store';
import type { TodoItem } from '@shared/types';

function TodoItemRow({ item }: { item: TodoItem }) {
  const statusColor = {
    pending: 'text-[var(--text-tertiary)]',
    in_progress: 'text-[var(--accent-primary)]',
    completed: 'text-[var(--accent-success)]',
  }[item.status];

  const statusIcon = {
    pending: '○',
    in_progress: '●',
    completed: '✓',
  }[item.status];

  return (
    <div className="flex items-start gap-2 text-[13px] leading-relaxed">
      <span className={`shrink-0 ${statusColor}`}>{statusIcon}</span>
      <span className={item.status === 'completed' ? 'text-[var(--text-tertiary)] line-through' : 'text-[var(--text-primary)]'}>
        {item.step}
      </span>
    </div>
  );
}

export default function TodoPanel({ threadId }: { threadId: string }) {
  const state = useGlobalStore((s) => s.agent.todoByThreadId[threadId]);
  const toggleCollapsed = useGlobalStore((s) => s.toggleTodoCollapsed);

  if (!state?.hasSeenNonEmptyTodo) return null;

  const { items, collapsed } = state;

  const pending = items.filter((i) => i.status === 'pending').length;
  const inProgress = items.filter((i) => i.status === 'in_progress').length;
  const completed = items.filter((i) => i.status === 'completed').length;
  const total = items.length;
  const allCompleted = total > 0 && completed === total;

  const summary = allCompleted
    ? `全部完成 · ${total} 项记录`
    : [
        inProgress > 0 ? `${inProgress} 进行中` : '',
        pending > 0 ? `${pending} 待处理` : '',
        completed > 0 ? `${completed} 已完成` : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'Todo';

  return (
    <div className="shrink-0 border-t border-[var(--border-card)] bg-[var(--bg-card)]">
      {/* Collapsed header — always visible when panel is shown */}
      <button
        type="button"
        onClick={() => toggleCollapsed(threadId)}
        className="w-full flex items-center justify-between px-5 py-2 text-[13px] hover:bg-[var(--border-default)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--text-title)]">Todo</span>
          <span className="text-[var(--text-tertiary)]">{summary}</span>
        </div>
        <span className="text-[var(--text-placeholder)]">{collapsed ? '⌃' : '⌄'}</span>
      </button>

      {/* Expanded list */}
      {!collapsed && (
        <div className="px-5 pb-3 max-h-[220px] overflow-y-auto">
          {allCompleted && <div className="text-[12px] text-[var(--accent-success)] mb-2">全部完成</div>}
          <div className="space-y-1.5">
            {items.map((item, index) => (
              <TodoItemRow key={index} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
