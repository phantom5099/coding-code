import { Hono } from 'hono';
import { Effect } from 'effect';
import { ApprovalWaitService } from '../../approval/async-confirm';
import { parseApprovalResponse } from '../../approval/response';
import { runWithLayer, errorResponse } from '../util.js';

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
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }

  return c.json({ ok: result.value });
});

export { router as approvalRouter };
