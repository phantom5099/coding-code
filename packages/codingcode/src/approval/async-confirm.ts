import { Effect, Deferred } from 'effect';
import type { ConfirmResult } from './confirmation';

// Module-level singleton: shared across all Effect.runPromise scopes
const pending = new Map<string, Deferred.Deferred<ConfirmResult, never>>();

export class ApprovalWaitService extends Effect.Service<ApprovalWaitService>()('ApprovalWait', {
  effect: Effect.gen(function* () {
    return {
      waitForConfirm: (id: string): Effect.Effect<ConfirmResult> =>
        Effect.gen(function* () {
          const d = yield* Deferred.make<ConfirmResult, never>();
          pending.set(id, d);

          // 60s timeout → auto deny
          yield* Effect.fork(
            Effect.sleep('60 seconds').pipe(
              Effect.flatMap(() => Deferred.succeed(d, { type: 'deny' } as ConfirmResult)),
              Effect.catchAll(() => Effect.void),
            ),
          );

          const result = yield* Deferred.await(d);
          return result;
        }),

      resolveConfirm: (id: string, result: ConfirmResult): Effect.Effect<boolean> =>
        Effect.sync(() => {
          const d = pending.get(id);
          if (!d) return false;
          pending.delete(id);
          Deferred.unsafeDone(d, Effect.succeed(result));
          return true;
        }),

      getPending: (): Effect.Effect<string[]> =>
        Effect.sync(() => Array.from(pending.keys())),
    };
  }),
}) {}

/** Module-level emitter for the SSE handler to inject an approval request emitter. Survives across Effect.runPromise boundaries. */
export const approvalEmitter = {
  current: null as ((id: string, tool: string, args: Record<string, unknown>) => void) | null,
};
