import { Layer, Effect } from 'effect';
import { TodoService } from './port.js';
import type { TodoItem } from '../contracts/types.js';

export const TodoLayer = Layer.effect(TodoService, Effect.sync(() => {
  const store = new Map<string, TodoItem[]>();
  return {
    read: (sessionId: string) => store.get(sessionId) ?? [],
    write: (sessionId: string, plan: TodoItem[]) => { store.set(sessionId, plan); },
    reset: () => { store.clear(); },
  };
}));
