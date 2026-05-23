import { Effect } from 'effect';
import type { Todo, TodoStatus } from './types';

const store = new Map<string, Todo[]>();

export interface TodoCounts {
  pending: number;
  completed: number;
  cancelled: number;
}

export function countByStatus(plan: Todo[]): TodoCounts {
  const c: TodoCounts = { pending: 0, completed: 0, cancelled: 0 };
  for (const t of plan) c[t.status]++;
  return c;
}

export const sharedTodoStore = {
  read: (agentId: string): Todo[] => store.get(agentId) ?? [],
  write: (agentId: string, plan: Todo[]): void => { store.set(agentId, plan); },
  reset: (): void => store.clear(),
};

export class TodoService extends Effect.Service<TodoService>()('TodoService', {
  effect: Effect.gen(function* () {
    return sharedTodoStore;
  }),
}) {}
