import { Layer, Effect, Deferred } from 'effect';
import type { ConfirmResult } from './confirmation.js';
import {
  ApprovalWaitService,
  type ConfirmationKey,
  type ResolveConfirmCommand,
} from './wait-port.js';

interface PendingEntry {
  readonly deferred: Deferred.Deferred<ConfirmResult, never>;
  readonly sessionId: string;
}

const DENY_RESULT: ConfirmResult = { type: 'deny' };

export const ApprovalWaitLayer = Layer.effect(
  ApprovalWaitService,
  Effect.sync(() => {
    const pendingConfirmations = new Map<string, PendingEntry>();

    return {
      waitForConfirm: (key: ConfirmationKey): Effect.Effect<ConfirmResult> =>
        Effect.gen(function* () {
          const d = yield* Deferred.make<ConfirmResult, never>();
          pendingConfirmations.set(key.callId, { deferred: d, sessionId: key.sessionId });
          return yield* Deferred.await(d);
        }),

      resolveConfirm: (cmd: ResolveConfirmCommand): Effect.Effect<boolean> =>
        Effect.sync(() => {
          const entry = pendingConfirmations.get(cmd.callId);
          if (!entry || entry.sessionId !== cmd.sessionId) return false;
          pendingConfirmations.delete(cmd.callId);
          Deferred.unsafeDone(entry.deferred, Effect.succeed(cmd.result));
          return true;
        }),

      cancelPendingFor: (sessionId: string): Effect.Effect<number> =>
        Effect.sync(() => {
          let cleared = 0;
          for (const [id, entry] of pendingConfirmations) {
            if (entry.sessionId !== sessionId) continue;
            pendingConfirmations.delete(id);
            Deferred.unsafeDone(entry.deferred, Effect.succeed(DENY_RESULT));
            cleared++;
          }
          return cleared;
        }),
    };
  })
);
