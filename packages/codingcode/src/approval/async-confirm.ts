import { Effect, Deferred } from 'effect';
import type { ConfirmResult } from './confirmation.js';

interface PendingEntry {
  deferred: Deferred.Deferred<ConfirmResult, never>;
  sessionId: string;
}

const pendingConfirmations = new Map<string, PendingEntry>();
const approvalEmitters = new Map<
  string,
  (id: string, tool: string, args: Record<string, unknown>) => void
>();

export function registerEmitter(
  sessionId: string,
  fn: (id: string, tool: string, args: Record<string, unknown>) => void
): void {
  approvalEmitters.set(sessionId, fn);
}

export function delegateEmitter(childSessionId: string, parentSessionId: string): void {
  const parentFn = approvalEmitters.get(parentSessionId);
  if (parentFn) {
    approvalEmitters.set(childSessionId, parentFn);
  }
}

export function unregisterEmitter(sessionId: string): void {
  approvalEmitters.delete(sessionId);
}

export function hasEmitter(sessionId: string): boolean {
  return approvalEmitters.has(sessionId);
}

export class ApprovalWaitService extends Effect.Service<ApprovalWaitService>()('ApprovalWait', {
  effect: Effect.succeed({
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
      args: Record<string, unknown>
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        approvalEmitters.get(sessionId)?.(id, tool, args);
      }),
  }),
}) {}
