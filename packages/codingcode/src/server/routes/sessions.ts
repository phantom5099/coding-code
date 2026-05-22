import { Hono } from 'hono';
import { Effect } from 'effect';
import { AppLayer } from '../../layer.js';
import { SessionService } from '../../session/store.js';
import { ContextService } from '../../context/context.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

export const sessionsRouter = new Hono();

sessionsRouter.get('/', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const sessions = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.listSessions(cwd);
    }),
  );
  return c.json(sessions);
});

sessionsRouter.post('/', async (c) => {
  const body = await c.req.json() as any;
  const state = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(resolveWorkspaceCwd(body.cwd), body.model ?? 'unknown', '0.1.0');
    }),
  );
  return c.json({ sessionId: state.sessionId });
});

sessionsRouter.post('/:id/resume', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as any;
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      const state = yield* svc.create(resolveWorkspaceCwd(body.cwd), 'unknown', '0.1.0', sessionId);
      return yield* svc.readHistory(state);
    }),
  );
  return c.json(result);
});

sessionsRouter.post('/:id/compact', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as any;
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      const ctx = yield* ContextService;
      const state = yield* svc.create(resolveWorkspaceCwd(body.cwd), 'unknown', '0.1.0', sessionId);
      return yield* ctx.compress(state.sessionId, null);
    }),
  );
  return c.json(result);
});
