import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { ApprovalService } from '../../approval/index.js';
import type { PermissionMode } from '../../approval/types.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'plan',
  'bypass',
]);

export function createAgentRouter(rt: ManagedRt): Hono {
  const router = new Hono();

  router.get('/permission-mode', async (c) => {
    const approval: any = await rt.runPromise(
      Effect.gen(function* () {
        return yield* ApprovalService;
      })
    );
    return c.json({ mode: approval.getPermissionMode() });
  });

  router.post('/permission-mode', async (c) => {
    const body = (await c.req.json()) as { mode: string };
    if (!VALID_PERMISSION_MODES.has(body.mode as PermissionMode)) {
      return c.json({ error: `Invalid mode: ${body.mode}` }, 400);
    }
    const approval: any = await rt.runPromise(
      Effect.gen(function* () {
        return yield* ApprovalService;
      })
    );
    await rt.runPromise(approval.setPermissionMode(body.mode as PermissionMode));
    return c.json({ mode: approval.getPermissionMode() });
  });

  return router;
}
