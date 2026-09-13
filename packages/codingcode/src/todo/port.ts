import { Context } from 'effect';
import type { TodoItem } from '../core/types.js';

export type { TodoItem };
export type Todo = TodoItem;

export interface TodoCounts {
  pending: number;
  in_progress: number;
  completed: number;
}

export interface TodoShape {
  read(sessionId: string): Todo[];
  write(sessionId: string, plan: Todo[]): void;
  reset(): void;
}

export class TodoService extends Context.Tag('Todo')<TodoService, TodoShape>() {}

export const TODO_MAX_ITEMS = 20;
export const TODO_MAX_STEP_LEN = 60;

export function countByStatus(plan: Todo[]): TodoCounts {
  const c: TodoCounts = { pending: 0, in_progress: 0, completed: 0 };
  for (const t of plan) c[t.status]++;
  return c;
}
