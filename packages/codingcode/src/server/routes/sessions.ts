import { Hono } from 'hono';
import { Effect } from 'effect';
import { join } from 'path';
import { AppLayer } from '../../layer.js';
import { SessionService, resolveSessionDir, getPermissionMode, setPermissionMode } from '../../session/store.js';
import { ContextService } from '../../context/context.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import { deleteSession, readUIHistory } from '../../session/store.js';

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
  const body = await c.req.json() as { cwd: string; initialPermissionMode?: string };
  const normalizedCwd = resolveWorkspaceCwd(body.cwd);
  const state = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      return yield* svc.create(normalizedCwd, 'unknown', '0.1.0');
    }),
  );

  // Set initial permission mode if provided
  if (body.initialPermissionMode) {
    const dir = resolveSessionDir(state.sessionId);
    if (dir) {
      const idxPath = join(dir, `${state.sessionId}.index.json`);
      setPermissionMode(state.sessionId, idxPath, body.initialPermissionMode);
    }
  }

  return c.json({ sessionId: state.sessionId });
});

sessionsRouter.post('/:id/resume', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json() as { cwd: string };
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
  const body = await c.req.json() as { cwd: string };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const svc = yield* SessionService;
      const ctx = yield* ContextService;
      const state = yield* svc.create(resolveWorkspaceCwd(body.cwd), 'unknown', '0.1.0', sessionId);
      return yield* ctx.compress(state.sessionId, state.projectPath, null);
    }),
  );
  return c.json(result);
});

sessionsRouter.delete('/:id', async (c) => {
  const sessionId = c.req.param('id');
  deleteSession(sessionId);
  return c.json({ ok: true });
});

sessionsRouter.get('/:id/history', async (c) => {
  const sessionId = c.req.param('id');
  const turns = readUIHistory(sessionId);
  return c.json(turns);
});

sessionsRouter.get('/:id/permission-mode', async (c) => {
  const sessionId = c.req.param('id');
  const dir = resolveSessionDir(sessionId);
  if (!dir) return c.json({ mode: 'default' });
  const idxPath = join(dir, `${sessionId}.index.json`);
  const mode = getPermissionMode(idxPath);
  return c.json({ mode });
});

sessionsRouter.put('/:id/permission-mode', async (c) => {
  const sessionId = c.req.param('id');
  const { mode } = await c.req.json<{ mode: string }>();
  const dir = resolveSessionDir(sessionId);
  if (!dir) return c.json({ error: 'Session not found' }, 404);
  const idxPath = join(dir, `${sessionId}.index.json`);
  setPermissionMode(sessionId, idxPath, mode);
  return c.json({ ok: true });
});
