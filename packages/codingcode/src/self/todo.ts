export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface Todo {
  step: string;
  status: TodoStatus;
}

export const TODO_MAX_ITEMS = 20;
export const TODO_MAX_STEP_LEN = 60;

export interface TodoCounts {
  pending: number;
  in_progress: number;
  completed: number;
}

export function countByStatus(plan: Todo[]): TodoCounts {
  const c: TodoCounts = { pending: 0, in_progress: 0, completed: 0 };
  for (const t of plan) c[t.status]++;
  return c;
}

const store = new Map<string, Todo[]>();

export const sharedTodoStore = {
  read: (agentId: string): Todo[] => store.get(agentId) ?? [],
  write: (agentId: string, plan: Todo[]): void => { store.set(agentId, plan); },
  reset: (): void => store.clear(),
};
