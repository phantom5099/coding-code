import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { SchedulerService } from '../../scheduler/port.js';
import { NotFoundError } from '../http-error.js';
import { AgentError } from '../../util/error.js';
import { json, pathParams, readJson, type Handler, type Router } from '../handler.js';
import type { AutomationSandbox, CreateAutomationInput } from '../../scheduler/types.js';

type AutomationBody = {
  name?: string;
  description?: string;
  cron?: string;
  timezone?: string;
  sandbox?: AutomationSandbox;
  projectCwd?: string;
  runOnce?: boolean;
  enabled?: boolean;
};

/** PATCH 只能改既有自动化的字段，不接受 projectCwd */
type AutomationPatchBody = Omit<AutomationBody, 'projectCwd'>;

/** 校验必填项后构造 CreateAutomationInput；缺字段返回 null，由调用方落 400。不用 `as` 断言未验证 body。 */
function toCreateInput(body: AutomationBody): CreateAutomationInput | null {
  const { name, description, cron, projectCwd } = body;
  if (!name || !description || !cron || !projectCwd) return null;
  return { ...body, name, description, cron, projectCwd };
}

const listAutomations: Handler = Effect.gen(function* () {
  const scheduler = yield* SchedulerService;
  return json(scheduler.list());
});

const createAutomation: Handler = Effect.gen(function* () {
  const body = yield* readJson<AutomationBody>();
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
  const body = yield* readJson<AutomationPatchBody>();
  const scheduler = yield* SchedulerService;
  const updated = scheduler.update(id ?? '', body);
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
  return json({ sessionId });
});

export const addAutomationsRoutes = (router: Router): Router =>
  router.pipe(
    HttpRouter.get('/api/automations', listAutomations),
    HttpRouter.post('/api/automations', createAutomation),
    HttpRouter.patch('/api/automations/:id', patchAutomation),
    HttpRouter.del('/api/automations/:id', deleteAutomation),
    HttpRouter.post('/api/automations/:id/run', runAutomation)
  );
