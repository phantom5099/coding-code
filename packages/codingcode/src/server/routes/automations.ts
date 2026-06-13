import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { SchedulerService } from '../../scheduler/service.js';
import { errorResponse } from '../util.js';
import { NotFoundError } from '../../core/error.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../../scheduler/types.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export function createAutomationsRouter(rt: ManagedRt): Hono {
  const router = new Hono();

  router.get('/', async (c) => {
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return scheduler.list();
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
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

  router.post('/', async (c) => {
    const body = (await c.req.json()) as CreateAutomationInput;

    if (!body.name || !body.description || !body.cron || !body.projectCwd) {
      return c.json({ error: 'Missing required fields: name, description, cron, projectCwd' }, 400);
    }

    const result = await rt.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        return scheduler.add(body);
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
          onFailure: (e) => ({ ok: false as const, error: e }),
        })
      )
    );

    if (!result.ok) {
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }

    return c.json(result.value, 201);
  });

  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json()) as UpdateAutomationInput;

    const result = await rt.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        const updated = scheduler.update(id, body);
        if (!updated) {
          return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
        }
        return updated;
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
          onFailure: (e) => ({ ok: false as const, error: e }),
        })
      )
    );

    if (!result.ok) {
      const { status, body: errBody } = errorResponse(result.error);
      return c.json(errBody, status as any);
    }

    return c.json(result.value);
  });

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');

    const result = await rt.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        const removed = scheduler.remove(id);
        if (!removed) {
          return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
        }
        return { ok: true };
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
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

  router.post('/:id/run', async (c) => {
    const id = c.req.param('id');

    const result = await rt.runPromise(
      Effect.gen(function* () {
        const scheduler = yield* SchedulerService;
        const sessionId = yield* Effect.tryPromise({
          try: () => scheduler.runOnce(id),
          catch: (e) => new NotFoundError(`Automation '${id}' not found or execution failed`),
        });
        return { sessionId };
      }).pipe(
        Effect.catchAllDefect((defect) =>
          Effect.fail(new Error(`Unexpected error: ${String(defect)}`))
        ),
        Effect.match({
          onSuccess: (a) => ({ ok: true as const, value: a }),
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

  return router;
}
