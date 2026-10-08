import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { SchedulerService } from '../../scheduler/port.js';
import { createRunWithLayer, errorBody } from '../util.js';
import { NotFoundError } from '../http-error.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../../scheduler/types.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function registerAutomationsRoutes(router: Hono, rt: ManagedRt): void {
  const runWithLayer = createRunWithLayer(rt);

  router.get('/api/automations', async (c) => {
    return c.json(
      await runWithLayer(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          return scheduler.list();
        })
      )
    );
  });

  router.post('/api/automations', async (c) => {
    const body = (await c.req.json()) as CreateAutomationInput;

    if (!body.name || !body.description || !body.cron || !body.projectCwd) {
      return c.json(
        errorBody('CONFIG_MISSING', 'Missing required fields: name, description, cron, projectCwd'),
        400
      );
    }

    const created = await runWithLayer(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return scheduler.add(body);
      })
    );

    return c.json(created, 201);
  });

  router.patch('/api/automations/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json()) as UpdateAutomationInput;

    const updated = await runWithLayer(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        const result = scheduler.update(id, body);
        if (!result) {
          return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
        }
        return result;
      })
    );

    return c.json(updated);
  });

  router.delete('/api/automations/:id', async (c) => {
    const id = c.req.param('id');

    const removed = await runWithLayer(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        if (!scheduler.remove(id)) {
          return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
        }
        return { ok: true };
      })
    );

    return c.json(removed);
  });

  router.post('/api/automations/:id/run', async (c) => {
    const id = c.req.param('id');

    const sessionId = await runWithLayer(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return yield* Effect.tryPromise({
          try: () => scheduler.runOnce(id),
          catch: () => new NotFoundError(`Automation '${id}' not found or execution failed`),
        });
      })
    );

    return c.json({ sessionId });
  });
}
