import type { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { SkillService } from '../../skills/port.js';
import { isGlobalCwd, resolveCwd } from '../../core/path.js';
import { AlreadyExistsError, NotFoundError } from '../../contracts/error.js';
import type { McpServerConfig } from '../../contracts/mcp.js';
import type { UserHookConfig } from '../../contracts/hooks.js';
import {
  loadMcpConfig,
  writeMcpConfig,
  loadGlobalMcpConfig,
  writeGlobalMcpConfig,
  resolveMcpConfig,
  setGlobalMcpServerEnabled,
  setProjectMcpServerEnabled,
} from '../../mcp/config.js';
import {
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  resolveHookConfigs,
  setGlobalHookEnabled,
  setProjectHookEnabled,
} from '../../hooks/config.js';
import { discoverGlobalSkillDirs, discoverProjectSkillDirs } from '../../skills/source.js';
import { getMemoryConfig } from '../../memory/config.js';
import {
  loadConfig,
  updateMaxSteps,
  updateMaxStopContinuations,
  updateContextCompactionModel,
  updateMemoryModel,
} from '@codingcode/infra/config';
import { MemoryService } from '../../memory/port.js';
import { createRunWithLayer } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export async function registerSettingsRoutes(router: Hono, rt: ManagedRt): Promise<void> {
  const runWithLayer = createRunWithLayer(rt);

  // ---- Helpers for CRUD with validation ----

  function mcpCreateServer(cwd: string, server: McpServerConfig): void {
    const servers = loadMcpConfig(cwd);
    if (servers.some((s) => s.name === server.name)) {
      throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
    }
    servers.push(server);
    writeMcpConfig(cwd, servers);
  }

  function mcpUpdateServer(cwd: string, name: string, server: McpServerConfig): void {
    const servers = loadMcpConfig(cwd);
    const idx = servers.findIndex((s) => s.name === name);
    if (idx === -1) throw new NotFoundError(`MCP server '${name}' not found`);
    if (server.name !== name && servers.some((s) => s.name === server.name)) {
      throw new AlreadyExistsError(`MCP server '${server.name}' already exists`);
    }
    servers[idx] = server;
    writeMcpConfig(cwd, servers);
  }

  function mcpDeleteServer(cwd: string, name: string): void {
    const servers = loadMcpConfig(cwd);
    if (!servers.some((s) => s.name === name)) {
      throw new NotFoundError(`MCP server '${name}' not found in project config`);
    }
    writeMcpConfig(
      cwd,
      servers.filter((s) => s.name !== name)
    );
  }

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

  // ---- Memory ----
  router.get('/api/settings/memory/config', (c) => {
    const cfg = getMemoryConfig();
    return c.json({
      enabled: cfg.enabled,
      model: cfg.model,
    });
  });

  router.post('/api/settings/memory/enabled', async (c) => {
    const body = (await c.req.json()) as { enabled: boolean };
    await rt.runPromise(
      Effect.gen(function* () {
        const m = yield* MemoryService;
        m.setMemoryEnabled(body.enabled);
      })
    );
    const enabled = await rt.runPromise(
      Effect.gen(function* () {
        const m = yield* MemoryService;
        return m.getMemoryEnabled();
      })
    );
    return c.json({ enabled });
  });

  router.post('/api/settings/memory/model', async (c) => {
    const body = (await c.req.json()) as { model: string };
    updateMemoryModel(body.model);
    return c.json({ model: body.model });
  });

  // ---- Agent config ----
  router.get('/api/settings/agent/config', (c) => {
    const cfg = loadConfig();
    return c.json({ maxSteps: cfg.maxSteps, maxStopContinuations: cfg.maxStopContinuations });
  });

  router.post('/api/settings/agent/config', async (c) => {
    const body = (await c.req.json()) as { maxSteps?: number; maxStopContinuations?: number };
    if (body.maxSteps !== undefined) updateMaxSteps(body.maxSteps);
    if (body.maxStopContinuations !== undefined)
      updateMaxStopContinuations(body.maxStopContinuations);
    const cfg = loadConfig();
    return c.json({ maxSteps: cfg.maxSteps, maxStopContinuations: cfg.maxStopContinuations });
  });

  // ---- Context config ----
  router.post('/api/settings/context/compaction-model', async (c) => {
    const body = (await c.req.json()) as { compactionModel: string };
    updateContextCompactionModel(body.compactionModel);
    return c.json({ compactionModel: body.compactionModel });
  });

  // ---- Hooks ----
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
    try {
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
    } catch (e) {
      if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  router.put('/api/settings/hooks/:name', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    const body = (await c.req.json()) as UserHookConfig;
    try {
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
    } catch (e) {
      if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
      if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
      throw e;
    }
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

  // ---- MCP ----
  router.get('/api/settings/mcp', async (c) => {
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      return c.json(
        loadGlobalMcpConfig().map((s) => ({
          ...s,
          enabled: s.enabled !== false,
          source: 'global' as const,
        }))
      );
    }
    const cwd = resolveCwd(rawCwd);
    const globalServers = loadGlobalMcpConfig();
    const projectServers = loadMcpConfig(cwd);
    const globalNames = new Set(globalServers.map((s) => s.name));
    const projectNames = new Set(projectServers.map((s) => s.name));
    const merged = resolveMcpConfig(cwd);
    return c.json(
      merged.map((s) => {
        const isFromProject = projectNames.has(s.name);
        const isFromGlobal = globalNames.has(s.name);
        const hasProjectOverride = isFromProject && isFromGlobal;
        return {
          ...s,
          enabled: s.enabled !== false,
          source: isFromProject ? 'project' : 'global',
          hasProjectOverride,
        };
      })
    );
  });

  router.post('/api/settings/mcp', async (c) => {
    const rawCwd = c.req.query('cwd');
    const body = (await c.req.json()) as McpServerConfig;
    try {
      if (isGlobalCwd(rawCwd)) {
        const servers = loadGlobalMcpConfig();
        if (servers.some((s) => s.name === body.name)) {
          throw new AlreadyExistsError(`MCP server '${body.name}' already exists`);
        }
        servers.push(body);
        writeGlobalMcpConfig(servers);
      } else {
        mcpCreateServer(resolveCwd(rawCwd), body);
      }
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  router.put('/api/settings/mcp/:name', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    const body = (await c.req.json()) as McpServerConfig;
    try {
      if (isGlobalCwd(rawCwd)) {
        const servers = loadGlobalMcpConfig();
        const idx = servers.findIndex((s) => s.name === name);
        if (idx === -1) throw new NotFoundError(`MCP server '${name}' not found`);
        if (body.name !== name && servers.some((s) => s.name === body.name)) {
          throw new AlreadyExistsError(`MCP server '${body.name}' already exists`);
        }
        servers[idx] = body;
        writeGlobalMcpConfig(servers);
      } else {
        mcpUpdateServer(resolveCwd(rawCwd), name, body);
      }
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
      if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  router.delete('/api/settings/mcp/:name', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      const servers = loadGlobalMcpConfig().filter((s) => s.name !== name);
      writeGlobalMcpConfig(servers);
    } else {
      mcpDeleteServer(resolveCwd(rawCwd), name);
    }
    return c.json({ ok: true });
  });

  // 开关就是配置里的 enabled 字段：改开关 = 写回对应层的 mcp.yaml
  router.post('/api/settings/mcp/:name/enabled', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    const body = (await c.req.json()) as { enabled: boolean };
    if (isGlobalCwd(rawCwd)) {
      setGlobalMcpServerEnabled(name, body.enabled);
    } else {
      setProjectMcpServerEnabled(resolveCwd(rawCwd), name, body.enabled);
    }
    return c.json({ ok: true });
  });

  // ---- Skills ----
  router.get('/api/settings/skills', async (c) => {
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      const cwd = resolveCwd(rawCwd);
      const result = await runWithLayer(
        Effect.gen(function* () {
          const skill = yield* SkillService;
          return yield* skill.getAll(cwd);
        })
      );
      const skills = result.ok ? result.value : [];
      return c.json(
        skills.map((s) => ({
          ...s,
          source: 'global' as const,
        }))
      );
    }
    const cwd = resolveCwd(rawCwd);
    const globalDirs = discoverGlobalSkillDirs();
    const projectDirs = discoverProjectSkillDirs(cwd);
    const globalNames = new Set(globalDirs.map((d) => d.name));
    const projectNames = new Set(projectDirs.map((d) => d.name));
    const result = await runWithLayer(
      Effect.gen(function* () {
        const skill = yield* SkillService;
        return yield* skill.getAll(cwd);
      })
    );
    const skills = result.ok ? result.value : [];
    return c.json(
      skills.map((s) => {
        const isFromProject = projectNames.has(s.name);
        const isFromGlobal = globalNames.has(s.name);
        const hasProjectOverride = isFromProject && isFromGlobal;
        return {
          ...s,
          source: isFromProject ? 'project' : 'global',
          hasProjectOverride,
        };
      })
    );
  });
}
