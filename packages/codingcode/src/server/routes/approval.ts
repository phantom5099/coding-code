import { Hono } from 'hono';
import { Effect } from 'effect';
import { ApprovalWaitService } from '../../approval/async-confirm';
import { AppLayer } from '../../layer';
import { parseApprovalResponse } from '../../approval/response';

const router = new Hono();

router.post('/sessions/:sessionId/approval/:id', async (c) => {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const { response } = await c.req.json<{ response: string }>();

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* ApprovalWaitService;
      return yield* svc.resolveConfirm(id, sessionId, parseApprovalResponse(response));
    }).pipe(Effect.provide(AppLayer) as any),
  );

  return c.json({ ok: result });
});

export { router as approvalRouter };
