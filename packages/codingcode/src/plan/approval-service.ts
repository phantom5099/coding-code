import { Effect, Deferred } from 'effect';
import { randomUUID } from 'crypto';
import type { PlanConfirmResult } from './plan-confirm.js';

interface PendingPlanEntry {
  deferred: Deferred.Deferred<PlanConfirmResult, never>;
  sessionId: string;
}

export type PlanApprovalEmitter = (
  id: string,
  tool: string,
  args: Record<string, unknown>,
  payload?: Record<string, unknown>
) => void;

export interface PlanDecisionRequest {
  sessionId: string;
  projectPath: string;
  planContent: string;
  planPath: string;
}

export class PlanApprovalService extends Effect.Service<PlanApprovalService>()('PlanApproval', {
  effect: Effect.gen(function* () {
    const pendingPlanApprovals = new Map<string, PendingPlanEntry>();
    const planEmitters = new Map<string, PlanApprovalEmitter>();

    return {
      requestPlanDecision: (
        req: PlanDecisionRequest
      ): Effect.Effect<PlanConfirmResult> =>
        Effect.gen(function* () {
          const id = `plan_${randomUUID()}`;
          const args = { plan_content: req.planContent };
          const payload = {
            kind: 'plan',
            planPath: req.planPath,
            projectPath: req.projectPath,
            sessionId: req.sessionId,
          };
          const emitter = planEmitters.get(req.sessionId);
          emitter?.(id, 'submit_plan', args, payload);

          const d = yield* Deferred.make<PlanConfirmResult, never>();
          pendingPlanApprovals.set(id, { deferred: d, sessionId: req.sessionId });
          return yield* Deferred.await(d);
        }),

      resolvePlanDecision: (
        id: string,
        _sessionId: string,
        result: PlanConfirmResult
      ): Effect.Effect<boolean> =>
        Effect.sync(() => {
          const entry = pendingPlanApprovals.get(id);
          if (!entry) return false;
          pendingPlanApprovals.delete(id);
          Deferred.unsafeDone(entry.deferred, Effect.succeed(result));
          return true;
        }),

      getPending: (sessionId?: string): Effect.Effect<string[]> =>
        Effect.sync(() => {
          if (sessionId) {
            return Array.from(pendingPlanApprovals.entries())
              .filter(([_, e]) => e.sessionId === sessionId)
              .map(([id]) => id);
          }
          return Array.from(pendingPlanApprovals.keys());
        }),

      registerEmitter: (sessionId: string, fn: PlanApprovalEmitter): Effect.Effect<void> =>
        Effect.sync(() => {
          planEmitters.set(sessionId, fn);
        }),

      unregisterEmitter: (sessionId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          planEmitters.delete(sessionId);
        }),

      hasEmitter: (sessionId: string): Effect.Effect<boolean> =>
        Effect.sync(() => planEmitters.has(sessionId)),
    };
  }),
}) {}
