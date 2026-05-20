import { Hono } from 'hono';
import { Effect } from 'effect';
import { AppLayer } from '../../layer.js';
import { SessionService } from '../../session/store.js';
import { compact, resumeSession } from '../../orchestrate.js';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

export const sessionsRouter = new Hono();

sessionsRouter.get('/', async (c) => {
  const sessions = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.listSessions();
    }),
  );
  return c.json(sessions);
});

sessionsRouter.post('/', async (c) => {
  const body = await c.req.json() as any;
  const state = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(body.cwd ?? process.cwd(), body.model ?? 'unknown', '0.1.0');
    }),
  );
  return c.json({ sessionId: state.sessionId });
});

sessionsRouter.post('/:id/resume', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as any;
  const result = await runWithLayer(resumeSession(sessionId, body.cwd ?? process.cwd()) as any);
  return c.json(result);
});

sessionsRouter.post('/:id/compact', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as any;
  const result = await runWithLayer(compact(sessionId, body.cwd ?? process.cwd()) as any);
  return c.json(result);
});
