import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { SubagentRunRegistryService } from '../../subagent/registry.js';
import { createRunWithLayer } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerSubagentsRoutes(router: Hono, rt: ManagedRt): void {
  const runWithLayer = createRunWithLayer(rt);

  router.post('/api/sessions/:id/subagents/stop', async (c) => {
    const sessionId = c.req.param('id');

    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const registry = yield* SubagentRunRegistryService;
          const stopped = yield* registry.stopAll(sessionId);
          return { stopped };
        })
      )
    );
  });
}
