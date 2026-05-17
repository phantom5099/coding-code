import { Hono } from 'hono';
import { Effect } from 'effect';
import { AppLayer } from '../../layer.js';
import { SessionService } from '../../session/store.js';
import { compact, resumeSession } from '../../orchestrate.js';

export const sessionsRouter = new Hono();

sessionsRouter.get('/', async (c) => {
  const sessions = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.listSessions();
    }).pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
  );
  return c.json(sessions);
});

sessionsRouter.post('/', async (c) => {
  const body = await c.req.json() as any;
  const state = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(body.cwd ?? process.cwd(), body.model ?? 'unknown', body.role ?? 'coder', '0.1.0');
    }).pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
  );
  return c.json({ sessionId: state.sessionId });
});

sessionsRouter.post('/:id/resume', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as any;

  const state = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(body.cwd ?? process.cwd(), 'unknown', 'coder', '0.1.0', sessionId);
    }).pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
  );

  const result = await Effect.runPromise(
    resumeSession(state, body.cwd ?? process.cwd()).pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
  );
  return c.json(result);
});

sessionsRouter.post('/:id/compact', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as any;

  const state = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(body.cwd ?? process.cwd(), 'unknown', 'coder', '0.1.0', sessionId);
    }).pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
  );

  const result = await Effect.runPromise(
    compact(state).pipe(Effect.provide(AppLayer)) as Effect.Effect<any, any, never>,
  );
  return c.json(result);
});
