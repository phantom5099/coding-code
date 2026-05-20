import { Hono } from 'hono';
import { Effect } from 'effect';
import { ApprovalWaitService } from '../../approval/async-confirm';
import { AppLayer } from '../../layer';
import type { ConfirmResult } from '../../approval/confirmation';

function parseResponse(response: string): ConfirmResult {
  switch (response) {
    case 'allow': return { type: 'allow' as const };
    case 'deny': return { type: 'deny' as const };
    case 'always': return {
      type: 'always' as const,
      rule: { id: `user-allow-${Date.now()}`, action: 'allow' as const, toolPattern: '*', reason: 'User always allows', source: 'user' as const },
    };
    case 'never': return {
      type: 'never' as const,
      rule: { id: `user-deny-${Date.now()}`, action: 'deny' as const, toolPattern: '*', reason: 'User never allows', source: 'user' as const },
    };
    default: return { type: 'deny' as const };
  }
}

const router = new Hono();

router.post('/sessions/:sessionId/approval/:id', async (c) => {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const { response } = await c.req.json<{ response: string }>();

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* ApprovalWaitService;
      return yield* svc.resolveConfirm(id, sessionId, parseResponse(response));
    }).pipe(Effect.provide(AppLayer) as any),
  );

  return c.json({ ok: result });
});

export { router as approvalRouter };
