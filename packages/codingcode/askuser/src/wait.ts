import { Layer, Effect, Deferred } from 'effect';
import type { AskAnswer, AskKey, ResolveAskCommand } from './port.js';
import { AskWaitService } from './port.js';

interface PendingEntry {
  readonly deferred: Deferred.Deferred<AskAnswer, never>;
  readonly sessionId: string;
}

const NO_ANSWER: AskAnswer = { status: 'no_answer' };

export const AskWaitLayer = Layer.effect(
  AskWaitService,
  Effect.sync(() => {
    const pendingAsks = new Map<string, PendingEntry>();

    return {
      waitForAsk: (key: AskKey): Effect.Effect<AskAnswer> =>
        Effect.gen(function* () {
          const d = yield* Deferred.make<AskAnswer, never>();
          pendingAsks.set(key.callId, { deferred: d, sessionId: key.sessionId });
          return yield* Deferred.await(d);
        }),

      resolveAsk: (cmd: ResolveAskCommand): Effect.Effect<boolean> =>
        Effect.sync(() => {
          const entry = pendingAsks.get(cmd.callId);
          if (!entry || entry.sessionId !== cmd.sessionId) return false;
          pendingAsks.delete(cmd.callId);
          Deferred.unsafeDone(entry.deferred, Effect.succeed(cmd.answer));
          return true;
        }),

      cancelPendingFor: (sessionId: string): Effect.Effect<number> =>
        Effect.sync(() => {
          let cleared = 0;
          for (const [id, entry] of pendingAsks) {
            if (entry.sessionId !== sessionId) continue;
            pendingAsks.delete(id);
            Deferred.unsafeDone(entry.deferred, Effect.succeed(NO_ANSWER));
            cleared++;
          }
          return cleared;
        }),

      forget: (callId: string): Effect.Effect<boolean> =>
        Effect.sync(() => pendingAsks.delete(callId)),
    };
  })
);
