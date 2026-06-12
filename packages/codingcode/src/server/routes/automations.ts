import { Hono } from 'hono';
import { Effect } from 'effect';
import { list, add, update, remove, runOnce } from '../../scheduler/service.js';
import { runWithLayer, errorResponse } from '../util.js';
import { NotFoundError } from '../../core/error.js';
import type { CreateAutomationInput, UpdateAutomationInput } from '../../scheduler/types.js';

export const automationsRouter = new Hono();

automationsRouter.get('/', async (c) => {
  const result = await runWithLayer(
    Effect.sync(() => list())
  );

  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }

  return c.json(result.value);
});

automationsRouter.post('/', async (c) => {
  const body = (await c.req.json()) as CreateAutomationInput;

  if (!body.name || !body.description || !body.cron || !body.projectCwd) {
    return c.json({ error: 'Missing required fields: name, description, cron, projectCwd' }, 400);
  }

  const result = await runWithLayer(
    Effect.sync(() => add(body))
  );

  if (!result.ok) {
    const { status, body: errBody } = errorResponse(result.error);
    return c.json(errBody, status as any);
  }

  return c.json(result.value, 201);
});

automationsRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as UpdateAutomationInput;

  const result = await runWithLayer(
    Effect.gen(function* () {
      const updated = update(id, body);
      if (!updated) {
        return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
      }
      return updated;
    })
  );

  if (!result.ok) {
    const { status, body: errBody } = errorResponse(result.error);
    return c.json(errBody, status as any);
  }

  return c.json(result.value);
});

automationsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const result = await runWithLayer(
    Effect.gen(function* () {
      const removed = remove(id);
      if (!removed) {
        return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
      }
      return { ok: true };
    })
  );

  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }

  return c.json(result.value);
});

automationsRouter.post('/:id/run', async (c) => {
  const id = c.req.param('id');

  const result = await runWithLayer(
    Effect.gen(function* () {
      const sessionId = yield* Effect.tryPromise({
        try: () => runOnce(id),
        catch: (e) => new NotFoundError(`Automation '${id}' not found or execution failed`),
      });
      return { sessionId };
    })
  );

  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }

  return c.json(result.value);
});
