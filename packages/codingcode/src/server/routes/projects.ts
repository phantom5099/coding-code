import { Hono } from 'hono';
import { Effect } from 'effect';
import { ProjectRuntimeService } from '../../runtime/project-runtime.js';
import { runWithLayer } from '../util.js';

export const projectsRouter = new Hono();

/** POST /api/projects/dispose — clear project-level caches so next message re-reads config */
projectsRouter.post('/dispose', async (c) => {
  const { cwd } = await c.req.json<{ cwd: string }>();
  if (!cwd) return c.json({ error: 'cwd required' }, 400);

  const result = await runWithLayer(
    Effect.gen(function* () {
      const runtime = yield* ProjectRuntimeService;
      yield* runtime.disposeProject(cwd);
    })
  );

  if (!result.ok) return c.json({ error: 'dispose failed' }, 500);
  return c.json({ ok: true });
});