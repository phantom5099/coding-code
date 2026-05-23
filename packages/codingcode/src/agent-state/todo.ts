import { Effect } from 'effect';

export type TodoStatus = 'pending' | 'completed' | 'cancelled';

export interface Todo {
  step: string;
  status: TodoStatus;
}

export const TODO_MAX_ITEMS = 20;
export const TODO_MAX_STEP_LEN = 60;

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

const store = new Map<string, Todo[]>();

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
