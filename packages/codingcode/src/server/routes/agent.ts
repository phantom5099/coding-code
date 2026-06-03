import { Hono } from 'hono';
import { getGlobalPermissionMode, setGlobalPermissionMode } from '../../approval/index.js';
import type { PermissionMode } from '../../approval/types.js';

const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'dontAsk',
  'plan',
  'bypass',
]);

export const agentRouter = new Hono();

agentRouter.get('/permission-mode', (c) => {
  return c.json({ mode: getGlobalPermissionMode() });
});

agentRouter.post('/permission-mode', async (c) => {
  const body = (await c.req.json()) as { mode: string };
  if (!VALID_PERMISSION_MODES.has(body.mode as PermissionMode)) {
    return c.json({ error: `Invalid mode: ${body.mode}` }, 400);
  }
  setGlobalPermissionMode(body.mode as PermissionMode);
  return c.json({ mode: getGlobalPermissionMode() });
});
