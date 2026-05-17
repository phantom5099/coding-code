import { Hono } from 'hono';
import { listRoles, switchRole } from '../../prompts/index.js';

let currentRole = '';

export const rolesRouter = new Hono();

rolesRouter.get('/', (c) => {
  const roles = listRoles();
  return c.json({ roles, currentRole });
});

rolesRouter.post('/switch', async (c) => {
  const { role } = await c.req.json() as { role: string };
  try {
    switchRole(role);
    currentRole = role;
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
