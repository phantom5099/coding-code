import { Layer, Effect, Deferred } from 'effect';
import type { AskAnswer } from './port.js';
import { AskWaitService } from './port.js';

interface PendingEntry {
  deferred: Deferred.Deferred<AskAnswer, never>;
  sessionId: string;
}

export const AskWaitLayer = Layer.effect(
  AskWaitService,
  Effect.sync(() => {
    const pendingAsks = new Map<string, PendingEntry>();

    return {
      waitForAsk: (id: string, sessionId: string): Effect.Effect<AskAnswer> =>
        Effect.gen(function* () {
          const d = yield* Deferred.make<AskAnswer, never>();
          pendingAsks.set(id, { deferred: d, sessionId });
          return yield* Deferred.await(d);
        }),

      resolveAsk: (id: string, sessionId: string, answer: AskAnswer): Effect.Effect<boolean> =>
        Effect.sync(() => {
          const entry = pendingAsks.get(id);
          if (!entry || entry.sessionId !== sessionId) return false;
          pendingAsks.delete(id);
          Deferred.unsafeDone(entry.deferred, Effect.succeed(answer));
          return true;
        }),

      cancelPendingFor: (sessionId: string): Effect.Effect<number> =>
        Effect.sync(() => {
          let cleared = 0;
          for (const [id, entry] of pendingAsks) {
            if (entry.sessionId !== sessionId) continue;
            pendingAsks.delete(id);
            Deferred.unsafeDone(
              entry.deferred,
              Effect.succeed({ status: 'no_answer' } as AskAnswer)
            );
            cleared++;
          }
          return cleared;
        }),

      forget: (id: string): Effect.Effect<boolean> =>
        Effect.sync(() => pendingAsks.delete(id)),
    };
  })
);
