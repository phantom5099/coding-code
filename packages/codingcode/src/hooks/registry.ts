import { Effect } from 'effect';

export type HookPoint =
  | 'tool.execute.before' | 'tool.execute.after' | 'tool.execute.error'
  | 'llm.request.before' | 'llm.response.after' | 'llm.response.error'
  | 'session.save.before' | 'session.save.after';

type HookHandler = (payload: Record<string, unknown>) => void | Promise<void>;

export class HookService extends Effect.Service<HookService>()('HookService', {
  effect: Effect.gen(function* () {
    const handlers = new Map<HookPoint, Set<HookHandler>>();

    return {
      register: (point: HookPoint, handler: HookHandler): Effect.Effect<() => void> =>
        Effect.sync(() => {
          const set = handlers.get(point) ?? new Set();
          set.add(handler);
          handlers.set(point, set);
          return () => {
            set.delete(handler);
          };
        }),

      emit: (point: HookPoint, payload: Record<string, unknown>): Effect.Effect<void> =>
        Effect.promise(async () => {
          const set = handlers.get(point);
          if (!set) return;
          for (const handler of set) await handler(payload);
        }),

      // Sync emit for callers outside Effect context (ToolExecutor)
      emitSync: async (point: HookPoint, payload: Record<string, unknown>): Promise<void> => {
        const set = handlers.get(point);
        if (!set) return;
        for (const handler of set) await handler(payload);
      },
    };
  }),
}) {}
