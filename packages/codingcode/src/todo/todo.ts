import { Layer, Effect } from 'effect';
import { TodoService } from './port.js';

export const TodoLayer = Layer.effect(TodoService, Effect.sync(() => {
  const store = new Map<string, import('./port.js').Todo[]>();
  return {
    read: (sessionId: string) => store.get(sessionId) ?? [],
    write: (sessionId: string, plan: import('./port.js').Todo[]) => { store.set(sessionId, plan); },
    reset: () => { store.clear(); },
  };
}));
