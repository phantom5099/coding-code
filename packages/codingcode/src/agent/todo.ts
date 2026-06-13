import { Effect } from 'effect';
import type { Todo, TodoCounts } from './types.js';

export const TODO_MAX_ITEMS = 20;
export const TODO_MAX_STEP_LEN = 60;

export function countByStatus(plan: Todo[]): TodoCounts {
  const c: TodoCounts = { pending: 0, in_progress: 0, completed: 0 };
  for (const t of plan) c[t.status]++;
  return c;
}

export class TodoService extends Effect.Service<TodoService>()('Todo', {
  sync: () => {
    const store = new Map<string, Todo[]>();

    return {
      read(sessionId: string): Todo[] {
        return store.get(sessionId) ?? [];
      },

      write(sessionId: string, plan: Todo[]): void {
        store.set(sessionId, plan);
      },

      reset(): void {
        store.clear();
      },
    };
  },
}) {}
