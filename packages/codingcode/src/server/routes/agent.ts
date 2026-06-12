import { Hono } from 'hono';
import { Effect } from 'effect';
import { ApprovalService } from '../../approval/index.js';
import { AppLayer } from '../../layer.js';
import type { PermissionMode } from '../../approval/types.js';

const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'plan',
  'bypass',
]);

export const agentRouter = new Hono();

agentRouter.get('/permission-mode', async (c) => {
  const approval: any = await Effect.runPromise(Effect.gen(function* () { return yield* ApprovalService; }).pipe(Effect.provide(AppLayer) as any));
  return c.json({ mode: approval.getPermissionMode() });
});

agentRouter.post('/permission-mode', async (c) => {
  const body = (await c.req.json()) as { mode: string };
  if (!VALID_PERMISSION_MODES.has(body.mode as PermissionMode)) {
    return c.json({ error: `Invalid mode: ${body.mode}` }, 400);
  }
  const approval: any = await Effect.runPromise(Effect.gen(function* () { return yield* ApprovalService; }).pipe(Effect.provide(AppLayer) as any));
  await Effect.runPromise(approval.setPermissionMode(body.mode as PermissionMode));
  return c.json({ mode: approval.getPermissionMode() });
});
