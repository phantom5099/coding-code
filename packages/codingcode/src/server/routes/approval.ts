import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { ApprovalWaitService } from '../../approval/wait-port.js';
import { parseApprovalResponse } from '../../approval/confirmation.js';
import { createRunWithLayer } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerApprovalRoutes(router: Hono, rt: ManagedRt): void {
  const runWithLayer = createRunWithLayer(rt);

  router.post('/api/sessions/:sessionId/approval/:id', async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as {
      response?: string;
    };
    const response = typeof body.response === 'string' ? body.response : '';

    const resolved = await runWithLayer(
      Effect.gen(function* () {
        const svc = yield* ApprovalWaitService;
        return yield* svc.resolveConfirm(id, sessionId, parseApprovalResponse(response));
      })
    );

    return c.json({ ok: resolved });
  });
}
