import { Hono } from 'hono';
import { Effect } from 'effect';
import { AppLayer } from '../../layer.js';
import { compact, resumeSession } from '../../orchestrate.js';

export const sessionsRouter = new Hono();

sessionsRouter.get('/', async (c) => c.json([]));

sessionsRouter.post('/:id/resume', async (c) => {
  const body = await c.req.json() as any;
  const program = resumeSession(body.state as any, body.cwd as string).pipe(Effect.provide(AppLayer));
  const result = await Effect.runPromise(program as any);
  return c.json(result);
});

sessionsRouter.post('/:id/compact', async (c) => {
  const body = await c.req.json() as any;
  const program = compact(body.state as any).pipe(Effect.provide(AppLayer));
  const result = await Effect.runPromise(program as any);
  return c.json(result);
});
