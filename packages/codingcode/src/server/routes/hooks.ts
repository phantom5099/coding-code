import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { isGlobalCwd, resolveCwd } from '../cwd.js';
import { AlreadyExistsError, NotFoundError, type AppError } from '../http-error.js';
import { AgentError } from '../../util/error.js';
import { json, pathParams, query, readJson, type Handler, type Router } from '../handler.js';
import type { UserHookConfig } from '../../hooks/types.js';
import {
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  resolveHookConfigs,
  setGlobalHookEnabled,
  setProjectHookEnabled,
} from '../../hooks/config.js';

function toHookConfig(body: Partial<UserHookConfig>): UserHookConfig | null {
  const { name, point, type, command } = body;
  if (!name || !point || !type || !command) return null;
  return { ...body, name, point, type, command };
}

const MISSING_FIELDS = 'Missing required fields: name, point, type, command';

const hooksCreate = (cwd: string, hook: UserHookConfig): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const hooks = loadHookConfigs(cwd);
    if (hooks.some((h) => h.name === hook.name)) {
      return yield* Effect.fail(new AlreadyExistsError(`Hook '${hook.name}' already exists`));
    }
    hooks.push(hook);
    writeHookConfigs(cwd, hooks);
  });

const hooksUpdate = (
  cwd: string,
  name: string,
  hook: UserHookConfig
): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const hooks = loadHookConfigs(cwd);
    const idx = hooks.findIndex((h) => h.name === name);
    if (idx === -1) return yield* Effect.fail(new NotFoundError(`Hook '${name}' not found`));
    if (hook.name !== name && hooks.some((h) => h.name === hook.name)) {
      return yield* Effect.fail(new AlreadyExistsError(`Hook '${hook.name}' already exists`));
    }
    hooks[idx] = hook;
    writeHookConfigs(cwd, hooks);
  });

const hooksDelete = (cwd: string, name: string): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const hooks = loadHookConfigs(cwd);
    if (!hooks.some((h) => h.name === name)) {
      return yield* Effect.fail(new NotFoundError(`Hook '${name}' not found in project config`));
    }
    writeHookConfigs(
      cwd,
      hooks.filter((h) => h.name !== name)
    );
  });

const listHooks: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  if (isGlobalCwd(rawCwd)) {
    return json(
      loadGlobalHookConfigs().map((h) => ({
        ...h,
        enabled: h.enabled !== false,
        source: 'global' as const,
      }))
    );
  }

  const cwd = resolveCwd(rawCwd);
  const globalHooks = loadGlobalHookConfigs();
  const projectHooks = loadHookConfigs(cwd);
  const globalNames = new Set(globalHooks.map((h) => h.name));
  const projectNames = new Set(projectHooks.map((h) => h.name));
  return json(
    resolveHookConfigs(cwd).map((h) => {
      const isFromProject = projectNames.has(h.name);
      const isFromGlobal = globalNames.has(h.name);
      return {
        ...h,
        enabled: h.enabled !== false,
        source: isFromProject ? 'project' : 'global',
        hasProjectOverride: isFromProject && isFromGlobal,
      };
    })
  );
});

const createHook: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<Partial<UserHookConfig>>();
  const hook = toHookConfig(body);
  if (!hook) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_FIELDS));

  if (isGlobalCwd(rawCwd)) {
    const hooks = loadGlobalHookConfigs();
    if (hooks.some((h) => h.name === hook.name)) {
      return yield* Effect.fail(new AlreadyExistsError(`Hook '${hook.name}' already exists`));
    }
    hooks.push(hook);
    writeGlobalHookConfigs(hooks);
  } else {
    yield* hooksCreate(resolveCwd(rawCwd), hook);
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
  if (isGlobalCwd(rawCwd)) {
    const hooks = loadGlobalHookConfigs();
    const idx = hooks.findIndex((h) => h.name === target);
    if (idx === -1) return yield* Effect.fail(new NotFoundError(`Hook '${target}' not found`));
    if (hook.name !== target && hooks.some((h) => h.name === hook.name)) {
      return yield* Effect.fail(new AlreadyExistsError(`Hook '${hook.name}' already exists`));
    }
    hooks[idx] = hook;
    writeGlobalHookConfigs(hooks);
  } else {
    yield* hooksUpdate(resolveCwd(rawCwd), target, hook);
  }
  return json({ ok: true });
});

const deleteHook: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const target = name ?? '';
  if (isGlobalCwd(rawCwd)) {
    writeGlobalHookConfigs(loadGlobalHookConfigs().filter((h) => h.name !== target));
  } else {
    yield* hooksDelete(resolveCwd(rawCwd), target);
  }
  return json({ ok: true });
});

// 开关就是配置里的 enabled 字段：改开关 = 写回对应层的 hooks.yaml
const setHookEnabled: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const body = yield* readJson<{ enabled: boolean }>();
  const { cwd: rawCwd } = yield* query;
  const target = name ?? '';
  if (isGlobalCwd(rawCwd)) {
    setGlobalHookEnabled(target, body.enabled);
  } else {
    setProjectHookEnabled(resolveCwd(rawCwd), target, body.enabled);
  }
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
