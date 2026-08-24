import { Hono } from 'hono';
import { Effect, ManagedRuntime } from 'effect';
import { SkillService } from '../../skills/service.js';
import { WorkspaceService, isGlobalCwd } from '../../core/workspace.js';
import { AlreadyExistsError, NotFoundError } from '../../core/error.js';
import type { McpServerConfig } from '../../mcp/types.js';
import type { UserHookConfig } from '../../hooks/types.js';
import {
  loadMcpConfig,
  writeMcpConfig,
  loadGlobalMcpConfig,
  writeGlobalMcpConfig,
  resolveMcpConfig,
  resolveMcpDisabled,
  getGlobalMcpDisabledState,
  setGlobalMcpDisabledState,
  setProjectMcpDisabledState,
  resetProjectMcpDisabledState,
} from '../../mcp/config.js';
import {
  loadHookConfigs,
  writeHookConfigs,
  loadGlobalHookConfigs,
  writeGlobalHookConfigs,
  resolveHookConfigs,
  resolveHookDisabled,
  setGlobalHookDisabledState,
  setProjectHookDisabledState,
  resetProjectHookDisabledState,
} from '../../hooks/config.js';
import { setHookRuntimeEnabled } from '../../hooks/executor.js';
import { discoverGlobalSkillDirs, discoverProjectSkillDirs } from '../../skills/source.js';
import {
  getMemoryConfig,
  getAllTypesWithStatus,
  setMemoryTypeDisabled,
  addMemoryExtraType as _addMemoryExtraType,
  updateMemoryExtraType as _updateMemoryExtraType,
  deleteMemoryExtraType as _deleteMemoryExtraType,
} from '../../memory/config.js';
import {
  loadConfig,
  updateMaxSteps,
  updateMaxStopContinuations,
  updateContextCompactionModel,
  updateMemoryModel,
} from '@codingcode/infra/config';
import { MemoryService } from '../../memory/index.js';
import { createRunWithLayer } from '../util.js';

type ManagedRt = ManagedRuntime.ManagedRuntime<any, any>;

export async function createSettingsRouter(rt: ManagedRt): Promise<Hono> {
  const settingsRouter = new Hono();
  const runWithLayer = createRunWithLayer(rt);
  const ws = await rt.runPromise(
    Effect.gen(function* () {
      return yield* WorkspaceService;
    })
  );
  const resolveWorkspaceCwd = (override?: string) => ws.resolveWorkspaceCwd(override);

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
  settingsRouter.get('/memory/config', (c) => {
    const cfg = getMemoryConfig();
    return c.json({
      enabled: cfg.enabled,
      types: getAllTypesWithStatus(cfg),
      model: cfg.model,
    });
  });

  settingsRouter.post('/memory/enabled', async (c) => {
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

  settingsRouter.post('/memory/type-disabled', async (c) => {
    const body = (await c.req.json()) as { name: string; disabled: boolean };
    setMemoryTypeDisabled(body.name, body.disabled);
    return c.json({ ok: true });
  });

  settingsRouter.post('/memory/extra-type', async (c) => {
    const body = (await c.req.json()) as { name: string; description: string };
    try {
      _addMemoryExtraType({ name: body.name, description: body.description, enabled: true });
      return c.json({ ok: true });
    } catch (e: any) {
      if (e.message?.includes('already exists')) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  settingsRouter.put('/memory/extra-type/:name', async (c) => {
    const name = c.req.param('name');
    const body = (await c.req.json()) as { name: string; description: string };
    try {
      _updateMemoryExtraType(name, {
        name: body.name,
        description: body.description,
        enabled: true,
      });
      return c.json({ ok: true });
    } catch (e: any) {
      if (e.message?.includes('not found')) return c.json({ error: e.message }, 404);
      if (e.message?.includes('already exists')) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  settingsRouter.delete('/memory/extra-type/:name', async (c) => {
    const name = c.req.param('name');
    try {
      _deleteMemoryExtraType(name);
      return c.json({ ok: true });
    } catch (e: any) {
      if (e.message?.includes('not found')) return c.json({ error: e.message }, 404);
      throw e;
    }
  });

  settingsRouter.post('/memory/model', async (c) => {
    const body = (await c.req.json()) as { model: string };
    updateMemoryModel(body.model);
    return c.json({ model: body.model });
  });

  // ---- Agent config ----
  settingsRouter.get('/agent/config', (c) => {
    const cfg = loadConfig();
    return c.json({ maxSteps: cfg.maxSteps, maxStopContinuations: cfg.maxStopContinuations });
  });

  settingsRouter.post('/agent/config', async (c) => {
    const body = (await c.req.json()) as { maxSteps?: number; maxStopContinuations?: number };
    if (body.maxSteps !== undefined) updateMaxSteps(body.maxSteps);
    if (body.maxStopContinuations !== undefined)
      updateMaxStopContinuations(body.maxStopContinuations);
    const cfg = loadConfig();
    return c.json({ maxSteps: cfg.maxSteps, maxStopContinuations: cfg.maxStopContinuations });
  });

  // ---- Context config ----
  settingsRouter.post('/context/compaction-model', async (c) => {
    const body = (await c.req.json()) as { compactionModel: string };
    updateContextCompactionModel(body.compactionModel);
    return c.json({ compactionModel: body.compactionModel });
  });

  // ---- Hooks ----
  settingsRouter.get('/hooks', (c) => {
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      return c.json(
        loadGlobalHookConfigs().map((h) => ({
          ...h,
          source: 'global' as const,
        }))
      );
    }
    const cwd = resolveWorkspaceCwd(rawCwd);
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
          source: isFromProject ? 'project' : 'global',
          hasProjectOverride,
          disabled: resolveHookDisabled(cwd, h.name),
        };
      })
    );
  });

  settingsRouter.post('/hooks', async (c) => {
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
        hooksCreate(resolveWorkspaceCwd(rawCwd), body);
      }
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  settingsRouter.put('/hooks/:name', async (c) => {
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
        hooksUpdate(resolveWorkspaceCwd(rawCwd), name, body);
      }
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
      if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  settingsRouter.delete('/hooks/:name', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      const hooks = loadGlobalHookConfigs().filter((h) => h.name !== name);
      writeGlobalHookConfigs(hooks);
    } else {
      hooksDelete(resolveWorkspaceCwd(rawCwd), name);
    }
    return c.json({ ok: true });
  });

  settingsRouter.post('/hooks/:name/disabled', async (c) => {
    const name = c.req.param('name');
    const body = (await c.req.json()) as { disabled: boolean };
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      setGlobalHookDisabledState(name, body.disabled);
      setHookRuntimeEnabled(name, !body.disabled);
      const hooks = loadGlobalHookConfigs();
      const hook = hooks.find((h) => h.name === name);
      if (hook) {
        hook.enabled = !body.disabled;
        writeGlobalHookConfigs(hooks);
      }
    } else {
      const cwd = resolveWorkspaceCwd(rawCwd);
      setProjectHookDisabledState(cwd, name, body.disabled);
      setHookRuntimeEnabled(name, !body.disabled);
      const hooks = loadHookConfigs(cwd);
      const hook = hooks.find((h) => h.name === name);
      if (hook) {
        hook.enabled = !body.disabled;
        writeHookConfigs(cwd, hooks);
      }
    }
    return c.json({ ok: true });
  });

  settingsRouter.post('/hooks/:name/disabled/reset', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    resetProjectHookDisabledState(resolveWorkspaceCwd(rawCwd), name);
    return c.json({ ok: true });
  });

  // ---- MCP ----
  settingsRouter.get('/mcp', async (c) => {
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      return c.json(
        loadGlobalMcpConfig().map((s) => ({
          ...s,
          disabled: getGlobalMcpDisabledState(s.name),
          source: 'global' as const,
        }))
      );
    }
    const cwd = resolveWorkspaceCwd(rawCwd);
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
          disabled: resolveMcpDisabled(cwd, s.name),
          source: isFromProject ? 'project' : 'global',
          hasProjectOverride,
        };
      })
    );
  });

  settingsRouter.post('/mcp', async (c) => {
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
        mcpCreateServer(resolveWorkspaceCwd(rawCwd), body);
      }
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  settingsRouter.put('/mcp/:name', async (c) => {
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
        mcpUpdateServer(resolveWorkspaceCwd(rawCwd), name, body);
      }
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
      if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  settingsRouter.delete('/mcp/:name', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      const servers = loadGlobalMcpConfig().filter((s) => s.name !== name);
      writeGlobalMcpConfig(servers);
    } else {
      mcpDeleteServer(resolveWorkspaceCwd(rawCwd), name);
    }
    return c.json({ ok: true });
  });

  settingsRouter.post('/mcp/:name/disabled', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    const body = (await c.req.json()) as { disabled: boolean };
    if (isGlobalCwd(rawCwd)) {
      setGlobalMcpDisabledState(name, body.disabled);
    } else {
      setProjectMcpDisabledState(resolveWorkspaceCwd(rawCwd), name, body.disabled);
    }
    return c.json({ ok: true });
  });

  settingsRouter.post('/mcp/:name/disabled/reset', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    resetProjectMcpDisabledState(resolveWorkspaceCwd(rawCwd), name);
    return c.json({ ok: true });
  });

  // ---- Skills ----
  settingsRouter.get('/skills', async (c) => {
    const rawCwd = c.req.query('cwd');
    if (isGlobalCwd(rawCwd)) {
      const cwd = resolveWorkspaceCwd(rawCwd);
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
    const cwd = resolveWorkspaceCwd(rawCwd);
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

  return settingsRouter;
}
