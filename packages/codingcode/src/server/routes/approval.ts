import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { ApprovalWaitService } from '../../approval/async-confirm.js';
import { parseApprovalResponse } from '../../approval/response.js';
import { PlanApprovalService } from '../../plan/approval-service.js';
import { parsePlanApprovalResponse } from '../../plan/parse-plan-approval.js';
import { errorResponse } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function createApprovalRouter(rt: ManagedRt): Hono {
  const router = new Hono();

  router.post('/sessions/:sessionId/approval/:id', async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as {
      response?: string;
    };
    const response = typeof body.response === 'string' ? body.response : '';

    const result = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        return yield* svc.resolveConfirm(id, sessionId, parseApprovalResponse(response));
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
          onFailure: (e) => ({ ok: false as const, error: e }),
        })
      )
    );
    if (!result.ok) {
      const { status, body } = errorResponse(result.error);
      return c.json(body, status as any);
    }

    return c.json({ ok: result.value });
  });

  router.post('/sessions/:sessionId/plan-approval/:id', async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as {
      response?: string;
    };
    const response = typeof body.response === 'string' ? body.response : '';

    const result = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* PlanApprovalService;
        return yield* svc.resolvePlanDecision(
          id,
          sessionId,
          parsePlanApprovalResponse(response)
        );
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
          onFailure: (e) => ({ ok: false as const, error: e }),
        })
      )
    );
    if (!result.ok) {
      const { status, body } = errorResponse(result.error);
      return c.json(body, status as any);
    }

    return c.json({ ok: result.value });
  });

  return router;
}
