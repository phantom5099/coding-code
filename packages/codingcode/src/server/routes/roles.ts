import { Hono } from 'hono';
import { handler } from '../handler.js';
import { Effect } from 'effect';

export const rolesRouter = new Hono();

rolesRouter.get('/', handler(
  Effect.succeed({ roles: [], currentRole: '' }),
));

rolesRouter.post('/switch', handler(
  Effect.succeed({ ok: true }),
));
