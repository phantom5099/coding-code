import type { Hono } from 'hono';
import { isGlobalCwd, resolveCwd } from '../../core/path.js';
import { AlreadyExistsError, NotFoundError } from '../../contracts/error.js';
import type { UserHookConfig } from '../../contracts/hooks.js';
import {
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  resolveHookConfigs,
  setGlobalHookEnabled,
  setProjectHookEnabled,
} from '../../hooks/config.js';

function hooksCreate(cwd: string, hook: UserHookConfig): void {
  const hooks = loadHookConfigs(cwd);
  if (hooks.some((h) => h.name === hook.name)) {
    throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
  }
  hooks.push(hook);
  writeHookConfigs(cwd, hooks);
}

function hooksUpdate(cwd: string, name: string, hook: UserHookConfig): void {
  const hooks = loadHookConfigs(cwd);
  const idx = hooks.findIndex((h) => h.name === name);
  if (idx === -1) throw new NotFoundError(`Hook '${name}' not found`);
  if (hook.name !== name && hooks.some((h) => h.name === hook.name)) {
    throw new AlreadyExistsError(`Hook '${hook.name}' already exists`);
  }
  hooks[idx] = hook;
  writeHookConfigs(cwd, hooks);
}

function hooksDelete(cwd: string, name: string): void {
  const hooks = loadHookConfigs(cwd);
  if (!hooks.some((h) => h.name === name)) {
    throw new NotFoundError(`Hook '${name}' not found in project config`);
  }
  writeHookConfigs(
    cwd,
    hooks.filter((h) => h.name !== name)
  );
}

export function registerHooksSettingsRoutes(router: Hono): void {
  router.get('/api/settings/hooks', (c) => {
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      return c.json(
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
    const merged = resolveHookConfigs(cwd);
    return c.json(
      merged.map((h) => {
        const isFromProject = projectNames.has(h.name);
        const isFromGlobal = globalNames.has(h.name);
        const hasProjectOverride = isFromProject && isFromGlobal;
        return {
          ...h,
          enabled: h.enabled !== false,
          source: isFromProject ? 'project' : 'global',
          hasProjectOverride,
        };
      })
    );
  });

  router.post('/api/settings/hooks', async (c) => {
    const rawCwd = c.req.query('cwd');
    const body = (await c.req.json()) as UserHookConfig;
    if (isGlobalCwd(rawCwd)) {
      const hooks = loadGlobalHookConfigs();
      if (hooks.some((h) => h.name === body.name)) {
        throw new AlreadyExistsError(`Hook '${body.name}' already exists`);
      }
      hooks.push(body);
      writeGlobalHookConfigs(hooks);
    } else {
      hooksCreate(resolveCwd(rawCwd), body);
    }
    return c.json({ ok: true });
  });

  router.put('/api/settings/hooks/:name', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    const body = (await c.req.json()) as UserHookConfig;
    if (isGlobalCwd(rawCwd)) {
      const hooks = loadGlobalHookConfigs();
      const idx = hooks.findIndex((h) => h.name === name);
      if (idx === -1) throw new NotFoundError(`Hook '${name}' not found`);
      if (body.name !== name && hooks.some((h) => h.name === body.name)) {
        throw new AlreadyExistsError(`Hook '${body.name}' already exists`);
      }
      hooks[idx] = body;
      writeGlobalHookConfigs(hooks);
    } else {
      hooksUpdate(resolveCwd(rawCwd), name, body);
    }
    return c.json({ ok: true });
  });

  router.delete('/api/settings/hooks/:name', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      const hooks = loadGlobalHookConfigs().filter((h) => h.name !== name);
      writeGlobalHookConfigs(hooks);
    } else {
      hooksDelete(resolveCwd(rawCwd), name);
    }
    return c.json({ ok: true });
  });

  // 开关就是配置里的 enabled 字段：改开关 = 写回对应层的 hooks.yaml
  router.post('/api/settings/hooks/:name/enabled', async (c) => {
    const name = c.req.param('name');
    const body = (await c.req.json()) as { enabled: boolean };
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      setGlobalHookEnabled(name, body.enabled);
    } else {
      setProjectHookEnabled(resolveCwd(rawCwd), name, body.enabled);
    }
    return c.json({ ok: true });
  });
}
