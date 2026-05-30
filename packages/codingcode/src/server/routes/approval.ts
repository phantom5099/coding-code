import { Hono } from 'hono';
import { Effect } from 'effect';
import { ApprovalWaitService } from '../../approval/async-confirm';
import { AppLayer } from '../../layer';
import { parseApprovalResponse } from '../../approval/response';

function runWithLayer<T>(eff: Effect.Effect<T, unknown, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

const router = new Hono();

router.post('/sessions/:sessionId/approval/:id', async (c) => {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const { response } = await c.req.json<{ response: string }>();

  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* ApprovalWaitService;
      return yield* svc.resolveConfirm(id, sessionId, parseApprovalResponse(response));
    }),
  );

  return c.json({ ok: result });
});

export { router as approvalRouter };
