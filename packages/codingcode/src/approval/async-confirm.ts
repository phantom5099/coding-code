import { Effect, Deferred } from 'effect';
import type { ConfirmResult } from './confirmation.js';

interface PendingEntry {
  deferred: Deferred.Deferred<ConfirmResult, never>;
  sessionId: string;
}

export class ApprovalWaitService extends Effect.Service<ApprovalWaitService>()('ApprovalWait', {
  effect: Effect.gen(function* () {
    const pendingConfirmations = new Map<string, PendingEntry>();
    const approvalEmitters = new Map<
      string,
      (
        id: string,
        tool: string,
        args: Record<string, unknown>,
        payload?: Record<string, unknown>
      ) => void
    >();

    return {
      waitForConfirm: (id: string, sessionId: string): Effect.Effect<ConfirmResult> =>
        Effect.gen(function* () {
          const d = yield* Deferred.make<ConfirmResult, never>();
          pendingConfirmations.set(id, { deferred: d, sessionId });
          return yield* Deferred.await(d);
        }),

      resolveConfirm: (
        id: string,
        _sessionId: string,
        result: ConfirmResult
      ): Effect.Effect<boolean> =>
        Effect.sync(() => {
          const entry = pendingConfirmations.get(id);
          if (!entry) return false;
          pendingConfirmations.delete(id);
          Deferred.unsafeDone(entry.deferred, Effect.succeed(result));
          return true;
        }),

      getPending: (sessionId?: string): Effect.Effect<string[]> =>
        Effect.sync(() => {
          if (sessionId) {
            return Array.from(pendingConfirmations.entries())
              .filter(([_, e]) => e.sessionId === sessionId)
              .map(([id]) => id);
          }
          return Array.from(pendingConfirmations.keys());
        }),

      emitApprovalRequest: (
        sessionId: string,
        id: string,
        tool: string,
        args: Record<string, unknown>,
        payload?: Record<string, unknown>
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          approvalEmitters.get(sessionId)?.(id, tool, args, payload);
        }),

      registerEmitter: (
        sessionId: string,
        fn: (
          id: string,
          tool: string,
          args: Record<string, unknown>,
          payload?: Record<string, unknown>
        ) => void
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          approvalEmitters.set(sessionId, fn);
        }),

      delegateEmitter: (childSessionId: string, parentSessionId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const parentFn = approvalEmitters.get(parentSessionId);
          if (parentFn) {
            approvalEmitters.set(childSessionId, parentFn);
          }
        }),

      unregisterEmitter: (sessionId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          approvalEmitters.delete(sessionId);
        }),

      hasEmitter: (sessionId: string): Effect.Effect<boolean> =>
        Effect.sync(() => approvalEmitters.has(sessionId)),
    };
  }),
}) {}
