import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import {
  SchedulerService,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from '@codingcode/scheduler';
import { NotFoundError } from '../http-error.js';
import { AgentError } from '@codingcode/util';
import { json, pathParams, readJson, type Handler, type Router } from '../handler.js';
import type { RunAutomationResult } from '../dto.js';

function toCreateInput(body: Partial<CreateAutomationInput>): CreateAutomationInput | null {
  const { name, description, cron, projectCwd } = body;
  if (!name || !description || !cron || !projectCwd) return null;
  return {
    name,
    description,
    cron,
    projectCwd,
    ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    ...(body.sandbox !== undefined ? { sandbox: body.sandbox } : {}),
    ...(body.runOnce !== undefined ? { runOnce: body.runOnce } : {}),
  };
}

function toUpdateInput(body: Partial<UpdateAutomationInput>): UpdateAutomationInput {
  return {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.cron !== undefined ? { cron: body.cron } : {}),
    ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    ...(body.sandbox !== undefined ? { sandbox: body.sandbox } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.runOnce !== undefined ? { runOnce: body.runOnce } : {}),
  };
}

const listAutomations: Handler = Effect.gen(function* () {
  const scheduler = yield* SchedulerService;
  return json(scheduler.list());
});

const createAutomation: Handler = Effect.gen(function* () {
  const body = yield* readJson<Partial<CreateAutomationInput>>();
  const input = toCreateInput(body);
  if (!input) {
    return yield* Effect.fail(
      new AgentError(
        'CONFIG_MISSING',
        'Missing required fields: name, description, cron, projectCwd'
      )
    );
  }
  const scheduler = yield* SchedulerService;
  return json(scheduler.add(input), 201);
});

const patchAutomation: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const body = yield* readJson<Partial<UpdateAutomationInput>>();
  const scheduler = yield* SchedulerService;
  const updated = scheduler.update(id ?? '', toUpdateInput(body));
  if (!updated) {
    return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
  }
  return json(updated);
});

const deleteAutomation: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const scheduler = yield* SchedulerService;
  if (!scheduler.remove(id ?? '')) {
    return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
  }
  return json({ ok: true });
});

const runAutomation: Handler = Effect.gen(function* () {
  const { id } = yield* pathParams;
  const scheduler = yield* SchedulerService;
  const sessionId = yield* Effect.tryPromise({
    try: () => scheduler.runOnce(id ?? ''),
    catch: () => new NotFoundError(`Automation '${id}' not found or execution failed`),
  });
  if (!sessionId) {
    return yield* Effect.fail(new NotFoundError(`Automation '${id}' not found`));
  }
  const result: RunAutomationResult = { sessionId };
  return json(result);
});

export const addAutomationsRoutes = (router: Router): Router =>
  router.pipe(
    HttpRouter.get('/api/automations', listAutomations),
    HttpRouter.post('/api/automations', createAutomation),
    HttpRouter.patch('/api/automations/:id', patchAutomation),
    HttpRouter.del('/api/automations/:id', deleteAutomation),
    HttpRouter.post('/api/automations/:id/run', runAutomation)
  );
