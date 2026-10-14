import { Context } from 'effect';
import type { Effect } from 'effect';
import type { TodoItem } from './types.js';

export interface TodoShape {
  read(sessionId: string): TodoItem[];
  write(sessionId: string, plan: TodoItem[]): void;
  dispose(sessionId: string): Effect.Effect<void>;
}

export class TodoService extends Context.Tag('Todo')<TodoService, TodoShape>() {}

export const TODO_MAX_ITEMS = 20;
export const TODO_MAX_STEP_LEN = 60;

export function formatTodoPlan(plan: TodoItem[]): string {
  if (plan.length === 0) return 'Todo list cleared (now empty).';
  const lines = plan.map((t, i) => `${i + 1}. [${t.status}] ${t.step}`);
  return `Current todo list (${plan.length} item${plan.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
}
