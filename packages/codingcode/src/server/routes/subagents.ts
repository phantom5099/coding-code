import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { SubagentRunRegistryService } from '../../subagent/registry.js';
import { errorResponse } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerSubagentsRoutes(router: Hono, rt: ManagedRt): void {
  router.post('/api/sessions/:id/subagents/stop', async (c) => {
    const sessionId = c.req.param('id');

    const result = await rt.runPromise(
      Effect.gen(function* () {
        const registry = yield* SubagentRunRegistryService;
        return yield* registry.stopAll(sessionId);
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (stopped) => ({ ok: true as const, value: { stopped } }),
          onFailure: (e) => ({ ok: false as const, error: e }),
        })
      )
    );

    if (!result.ok) {
      const { status, body } = errorResponse(result.error);
      return c.json(body, status as any);
    }

    return c.json(result.value);
  });
}
