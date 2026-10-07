import { Layer, Effect, Deferred } from 'effect';
import type { ConfirmResult } from './confirmation.js';
import { ApprovalWaitService } from './wait-port.js';

interface PendingEntry {
  deferred: Deferred.Deferred<ConfirmResult, never>;
  sessionId: string;
}

export const ApprovalWaitLayer = Layer.effect(
  ApprovalWaitService,
  Effect.sync(() => {
    const pendingConfirmations = new Map<string, PendingEntry>();

    return {
      waitForConfirm: (id: string, sessionId: string): Effect.Effect<ConfirmResult> =>
        Effect.gen(function* () {
          const d = yield* Deferred.make<ConfirmResult, never>();
          pendingConfirmations.set(id, { deferred: d, sessionId });
          return yield* Deferred.await(d);
        }),

      resolveConfirm: (
        id: string,
        sessionId: string,
        result: ConfirmResult
      ): Effect.Effect<boolean> =>
        Effect.sync(() => {
          const entry = pendingConfirmations.get(id);
          if (!entry || entry.sessionId !== sessionId) return false;
          pendingConfirmations.delete(id);
          Deferred.unsafeDone(entry.deferred, Effect.succeed(result));
          return true;
        }),

      cancelPendingFor: (sessionId: string): Effect.Effect<number> =>
        Effect.sync(() => {
          let cleared = 0;
          for (const [id, entry] of pendingConfirmations) {
            if (entry.sessionId !== sessionId) continue;
            pendingConfirmations.delete(id);
            Deferred.unsafeDone(entry.deferred, Effect.succeed({ type: 'deny' } as ConfirmResult));
            cleared++;
          }
          return cleared;
        }),
    };
  })
);
