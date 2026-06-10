import { Effect, Deferred } from 'effect';
import type { ConfirmResult } from './confirmation.js';

interface PendingEntry {
  deferred: Deferred.Deferred<ConfirmResult, never>;
  sessionId: string;
}

const pending = new Map<string, PendingEntry>();
const emitters = new Map<
  string,
  (id: string, tool: string, args: Record<string, unknown>) => void
>();

export function registerEmitter(
  sessionId: string,
  fn: (id: string, tool: string, args: Record<string, unknown>) => void
): void {
  emitters.set(sessionId, fn);
}

export function delegateEmitter(childSessionId: string, parentSessionId: string): void {
  const parentFn = emitters.get(parentSessionId);
  if (parentFn) {
    emitters.set(childSessionId, parentFn);
  }
}

export function unregisterEmitter(sessionId: string): void {
  emitters.delete(sessionId);
}

export function hasEmitter(sessionId: string): boolean {
  return emitters.has(sessionId);
}

export class ApprovalWaitService extends Effect.Service<ApprovalWaitService>()('ApprovalWait', {
  effect: Effect.succeed({
    waitForConfirm: (id: string, sessionId: string): Effect.Effect<ConfirmResult> =>
      Effect.gen(function* () {
        const d = yield* Deferred.make<ConfirmResult, never>();
        pending.set(id, { deferred: d, sessionId });
        return yield* Deferred.await(d);
      }),

    resolveConfirm: (
      id: string,
      _sessionId: string,
      result: ConfirmResult
    ): Effect.Effect<boolean> =>
      Effect.sync(() => {
        const entry = pending.get(id);
        if (!entry) return false;
        pending.delete(id);
        Deferred.unsafeDone(entry.deferred, Effect.succeed(result));
        return true;
      }),

    getPending: (sessionId?: string): Effect.Effect<string[]> =>
      Effect.sync(() => {
        if (sessionId) {
          return Array.from(pending.entries())
            .filter(([_, e]) => e.sessionId === sessionId)
            .map(([id]) => id);
        }
        return Array.from(pending.keys());
      }),

    emitApprovalRequest: (
      sessionId: string,
      id: string,
      tool: string,
      args: Record<string, unknown>
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        emitters.get(sessionId)?.(id, tool, args);
      }),
  }),
}) {}
