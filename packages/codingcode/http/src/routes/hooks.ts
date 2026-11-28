import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { resolveConfigScope } from '../cwd.js';
import { unwrapConfigOutcome } from '../http-error.js';
import { AgentError } from '@codingcode/util';
import { json, pathParams, query, readJson, type Handler, type Router } from '../handler.js';
import { HookService, type UserHookConfig } from '@codingcode/hook';

function toHookConfig(body: Partial<UserHookConfig>): UserHookConfig | null {
  const { name, point, type, command } = body;
  if (!name || !point || !type || !command) return null;
  return {
    name,
    point,
    type,
    command,
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.args !== undefined ? { args: body.args } : {}),
    ...(body.env !== undefined ? { env: body.env } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
  };
}

const MISSING_FIELDS = 'Missing required fields: name, point, type, command';

const listHooks: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const hooks = yield* HookService;
  return json(yield* hooks.listHooks(resolveConfigScope(rawCwd)));
});

const createHook: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<Partial<UserHookConfig>>();
  const hook = toHookConfig(body);
  if (!hook) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_FIELDS));

  const hooks = yield* HookService;
  const outcome = yield* hooks.createHook({ scope: resolveConfigScope(rawCwd), hook });
  yield* unwrapConfigOutcome(outcome, {
    alreadyExists: `Hook '${hook.name}' already exists`,
    notFound: `Hook '${hook.name}' not found`,
  });
  return json({ ok: true });
});

const updateHook: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<Partial<UserHookConfig>>();
  const hook = toHookConfig(body);
  if (!hook) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_FIELDS));

  const target = name ?? '';
  const hooks = yield* HookService;
  const outcome = yield* hooks.updateHook({
    scope: resolveConfigScope(rawCwd),
    name: target,
    hook,
  });
  yield* unwrapConfigOutcome(outcome, {
    alreadyExists: `Hook '${hook.name}' already exists`,
    notFound: `Hook '${target}' not found`,
  });
  return json({ ok: true });
});

const deleteHook: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const target = name ?? '';

  const hooks = yield* HookService;
  const outcome = yield* hooks.deleteHook({ scope: resolveConfigScope(rawCwd), name: target });
  yield* unwrapConfigOutcome(outcome, {
    alreadyExists: `Hook '${target}' already exists`,
    notFound: `Hook '${target}' not found in project config`,
  });
  return json({ ok: true });
});

const setHookEnabled: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const body = yield* readJson<{ enabled: boolean }>();
  const { cwd: rawCwd } = yield* query;

  const hooks = yield* HookService;
  yield* hooks.setHookEnabled({
    scope: resolveConfigScope(rawCwd),
    name: name ?? '',
    enabled: body.enabled,
  });
  return json({ ok: true });
});

export const addHooksSettingsRoutes = (router: Router): Router =>
  router.pipe(
    HttpRouter.get('/api/settings/hooks', listHooks),
    HttpRouter.post('/api/settings/hooks', createHook),
    HttpRouter.put('/api/settings/hooks/:name', updateHook),
    HttpRouter.del('/api/settings/hooks/:name', deleteHook),
    HttpRouter.post('/api/settings/hooks/:name/enabled', setHookEnabled)
  );
