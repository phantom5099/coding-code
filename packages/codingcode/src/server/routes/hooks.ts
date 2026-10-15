import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { isGlobalCwd, resolveCwd } from '../cwd.js';
import { AlreadyExistsError, NotFoundError } from '../http-error.js';
import { AgentError } from '../../util/error.js';
import { json, pathParams, query, readJson, type Handler, type Router } from '../handler.js';
import { HookService } from '../../hooks/port.js';
import type { UserHookConfig } from '../../hooks/types.js';

function toHookConfig(body: Partial<UserHookConfig>): UserHookConfig | null {
  const { name, point, type, command } = body;
  if (!name || !point || !type || !command) return null;
  return { ...body, name, point, type, command };
}

const MISSING_FIELDS = 'Missing required fields: name, point, type, command';

/** `?cwd` 约定 → 模块入参：空 / global 即全局层（undefined） */
const scopeOf = (rawCwd: string | undefined): string | undefined =>
  isGlobalCwd(rawCwd) ? undefined : resolveCwd(rawCwd);

const listHooks: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const hooks = yield* HookService;
  return json(yield* hooks.listHooks(scopeOf(rawCwd)));
});

const createHook: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<Partial<UserHookConfig>>();
  const hook = toHookConfig(body);
  if (!hook) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_FIELDS));

  const hooks = yield* HookService;
  const outcome = yield* hooks.createHook(scopeOf(rawCwd), hook);
  if (!outcome.ok) {
    return yield* Effect.fail(new AlreadyExistsError(`Hook '${hook.name}' already exists`));
  }
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
  const outcome = yield* hooks.updateHook(scopeOf(rawCwd), target, hook);
  if (!outcome.ok) {
    return yield* Effect.fail(
      outcome.reason === 'already-exists'
        ? new AlreadyExistsError(`Hook '${hook.name}' already exists`)
        : new NotFoundError(`Hook '${target}' not found`)
    );
  }
  return json({ ok: true });
});

const deleteHook: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const target = name ?? '';

  const hooks = yield* HookService;
  const outcome = yield* hooks.deleteHook(scopeOf(rawCwd), target);
  if (!outcome.ok) {
    return yield* Effect.fail(new NotFoundError(`Hook '${target}' not found in project config`));
  }
  return json({ ok: true });
});

const setHookEnabled: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const body = yield* readJson<{ enabled: boolean }>();
  const { cwd: rawCwd } = yield* query;

  const hooks = yield* HookService;
  yield* hooks.setHookEnabled(scopeOf(rawCwd), name ?? '', body.enabled);
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
