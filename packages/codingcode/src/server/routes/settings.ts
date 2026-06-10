import { Hono } from 'hono';
import { Effect } from 'effect';
import { SkillService } from '../../skills/service.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import { AlreadyExistsError, NotFoundError } from '../../core/error.js';
import type { McpServerConfig } from '../../mcp/types.js';
import type { AgentProfile } from '../../subagent/registry.js';
import type { UserHookConfig } from '../../hooks/config.js';
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
  loadAgentProfiles,
  writeAgentProfile,
  updateAgentProfile,
  deleteAgentProfile,
  loadGlobalAgentProfiles,
  writeGlobalAgentProfile,
  updateGlobalAgentProfile,
  deleteGlobalAgentProfile,
} from '../../subagent/loader.js';
import {
  EXPLORE_PROFILE,
  PLAN_PROFILE,
  resolveSubagentEnabled,
  getProjectSubagentEnabledState,
  setProjectSubagentEnabledState,
  resetProjectSubagentEnabledState,
  getGlobalAgentDisabledState,
  setGlobalAgentDisabledState,
  getProjectAgentDisabledState,
  setProjectAgentDisabledState,
  resetProjectAgentDisabledState,
  resolveAgentDisabled,
  getSubagentEnabledState,
  setSubagentEnabledState,
} from '../../subagent/registry.js';
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
import {
  setGlobalSkillDisabledState,
  setProjectSkillDisabledState,
  discoverGlobalSkillDirs,
  discoverProjectSkillDirs,
} from '../../skills/config.js';
import {
  getMemoryConfig,
  getAllTypesWithStatus,
  setMemoryTypeDisabled,
  addMemoryExtraType as _addMemoryExtraType,
  updateMemoryExtraType as _updateMemoryExtraType,
  deleteMemoryExtraType as _deleteMemoryExtraType,
} from '../../memory/config.js';
import { getMemoryEnabled, setMemoryEnabled } from '../../memory/index.js';
import { runWithLayer, errorResponse } from '../util.js';

export const settingsRouter = new Hono();

// ---- Helpers for global vs project ----

function isGlobalCwd(cwd: string | undefined): boolean {
  return !cwd || cwd === '' || cwd === 'global';
}

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
  const servers = loadMcpConfig(cwd).filter((s) => s.name !== name);
  writeMcpConfig(cwd, servers);
}

function agentsList(cwd: string): Array<{
  name: string;
  description: string;
  tools?: string[];
  mcpServers?: string[];
  readonly?: boolean;
  maxSteps?: number;
  model?: string;
  disabled: boolean;
  source: 'builtin' | 'global' | 'project';
  hasProjectOverride?: boolean;
  projectDisabled?: boolean;
}> {
  const globalCustom = loadGlobalAgentProfiles();
  const projectCustom = loadAgentProfiles(cwd);
  const globalNames = new Set(globalCustom.map((a) => a.name));
  const projectNames = new Set(projectCustom.map((a) => a.name));

  const result: Array<{
    name: string;
    description: string;
    tools?: string[];
    mcpServers?: string[];
    readonly?: boolean;
    maxSteps?: number;
    model?: string;
    disabled: boolean;
    source: 'builtin' | 'global' | 'project';
    hasProjectOverride?: boolean;
    projectDisabled?: boolean;
  }> = [];

  // builtin: EXPLORE_PROFILE
  const exploreProjectVal = getProjectAgentDisabledState(cwd, EXPLORE_PROFILE.name);
  result.push({
    name: EXPLORE_PROFILE.name,
    description: EXPLORE_PROFILE.description,
    tools: EXPLORE_PROFILE.tools,
    mcpServers: EXPLORE_PROFILE.mcpServers,
    readonly: EXPLORE_PROFILE.readonly,
    maxSteps: EXPLORE_PROFILE.maxSteps,
    model: EXPLORE_PROFILE.model,
    disabled: resolveAgentDisabled(cwd, EXPLORE_PROFILE.name),
    source: 'builtin',
    hasProjectOverride: exploreProjectVal !== undefined,
    projectDisabled: exploreProjectVal,
  });

  // builtin: PLAN_PROFILE
  const planProjectVal = getProjectAgentDisabledState(cwd, PLAN_PROFILE.name);
  result.push({
    name: PLAN_PROFILE.name,
    description: PLAN_PROFILE.description,
    tools: PLAN_PROFILE.tools,
    mcpServers: PLAN_PROFILE.mcpServers,
    readonly: PLAN_PROFILE.readonly,
    maxSteps: PLAN_PROFILE.maxSteps,
    model: PLAN_PROFILE.model,
    disabled: resolveAgentDisabled(cwd, PLAN_PROFILE.name),
    source: 'builtin',
    hasProjectOverride: planProjectVal !== undefined,
    projectDisabled: planProjectVal,
  });

  // global agents (not overridden by project)
  for (const a of globalCustom) {
    if (projectNames.has(a.name)) continue;
    const projectVal = getProjectAgentDisabledState(cwd, a.name);
    result.push({
      name: a.name,
      description: a.description,
      tools: a.tools,
      mcpServers: a.mcpServers,
      readonly: a.readonly,
      maxSteps: a.maxSteps,
      model: a.model,
      disabled: resolveAgentDisabled(cwd, a.name),
      source: 'global',
      hasProjectOverride: projectVal !== undefined,
      projectDisabled: projectVal,
    });
  }

  // project agents
  for (const a of projectCustom) {
    const projectVal = getProjectAgentDisabledState(cwd, a.name);
    result.push({
      name: a.name,
      description: a.description,
      tools: a.tools,
      mcpServers: a.mcpServers,
      readonly: a.readonly,
      maxSteps: a.maxSteps,
      model: a.model,
      disabled: resolveAgentDisabled(cwd, a.name),
      source: globalNames.has(a.name) ? 'global' : 'project',
      hasProjectOverride: projectVal !== undefined,
      projectDisabled: projectVal,
    });
  }

  return result;
}

function agentsCreate(cwd: string, profile: AgentProfile): void {
  const existing = loadAgentProfiles(cwd);
  if (existing.some((a) => a.name === profile.name)) {
    throw new AlreadyExistsError(`Agent '${profile.name}' already exists`);
  }
  writeAgentProfile(cwd, profile);
}

function agentsUpdate(cwd: string, name: string, profile: AgentProfile): void {
  const existing = loadAgentProfiles(cwd);
  if (!existing.some((a) => a.name === name)) throw new NotFoundError(`Agent '${name}' not found`);
  if (profile.name !== name && existing.some((a) => a.name === profile.name)) {
    throw new AlreadyExistsError(`Agent '${profile.name}' already exists`);
  }
  updateAgentProfile(cwd, name, profile);
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
  const hooks = loadHookConfigs(cwd).filter((h) => h.name !== name);
  writeHookConfigs(cwd, hooks);
}

// ---- Memory ----
settingsRouter.get('/memory/config', (c) => {
  const cfg = getMemoryConfig();
  return c.json({ enabled: cfg.enabled, types: getAllTypesWithStatus(cfg) });
});

settingsRouter.post('/memory/enabled', async (c) => {
  const body = (await c.req.json()) as { enabled: boolean };
  setMemoryEnabled(body.enabled);
  return c.json({ enabled: getMemoryEnabled() });
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
    _updateMemoryExtraType(name, { name: body.name, description: body.description, enabled: true });
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

// ---- Agents ----
settingsRouter.get('/agents', (c) => {
  const rawCwd = c.req.query('cwd');
  if (isGlobalCwd(rawCwd)) {
    const custom = loadGlobalAgentProfiles();
    return c.json(
      [EXPLORE_PROFILE, PLAN_PROFILE, ...custom].map((a) => ({
        name: a.name,
        description: a.description,
        tools: a.tools,
        mcpServers: a.mcpServers,
        readonly: a.readonly,
        maxSteps: a.maxSteps,
        model: a.model,
        disabled: getGlobalAgentDisabledState(a.name),
        source: a.name === EXPLORE_PROFILE.name || a.name === PLAN_PROFILE.name ? 'builtin' : 'global',
      }))
    );
  }
  const cwd = resolveWorkspaceCwd(rawCwd);
  return c.json(agentsList(cwd));
});

settingsRouter.post('/agents', async (c) => {
  const rawCwd = c.req.query('cwd');
  const body = (await c.req.json()) as AgentProfile;
  try {
    if (isGlobalCwd(rawCwd)) {
      const existing = loadGlobalAgentProfiles();
      if (existing.some((a) => a.name === body.name)) {
        throw new AlreadyExistsError(`Agent '${body.name}' already exists`);
      }
      writeGlobalAgentProfile(body);
    } else {
      agentsCreate(resolveWorkspaceCwd(rawCwd), body);
    }
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.put('/agents/:name', async (c) => {
  const name = c.req.param('name');
  const rawCwd = c.req.query('cwd');
  const body = (await c.req.json()) as AgentProfile;
  try {
    if (isGlobalCwd(rawCwd)) {
      updateGlobalAgentProfile(name, body);
    } else {
      agentsUpdate(resolveWorkspaceCwd(rawCwd), name, body);
    }
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.delete('/agents/:name', async (c) => {
  const name = c.req.param('name');
  const rawCwd = c.req.query('cwd');
  if (isGlobalCwd(rawCwd)) {
    deleteGlobalAgentProfile(name);
  } else {
    deleteAgentProfile(resolveWorkspaceCwd(rawCwd), name);
  }
  return c.json({ ok: true });
});

settingsRouter.post('/agents/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const rawCwd = c.req.query('cwd');
  const body = (await c.req.json()) as { disabled: boolean };
  if (isGlobalCwd(rawCwd)) {
    setGlobalAgentDisabledState(name, body.disabled);
  } else {
    setProjectAgentDisabledState(resolveWorkspaceCwd(rawCwd), name, body.disabled);
  }
  return c.json({ ok: true });
});

settingsRouter.post('/agents/:name/disabled/reset', async (c) => {
  const name = c.req.param('name');
  const rawCwd = c.req.query('cwd');
  resetProjectAgentDisabledState(resolveWorkspaceCwd(rawCwd), name);
  return c.json({ ok: true });
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
        source: isFromProject ? (hasProjectOverride ? 'global' : 'project') : 'global',
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
        source: isFromProject ? (hasProjectOverride ? 'global' : 'project') : 'global',
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
    const result = await runWithLayer(
      Effect.gen(function* () {
        const skill = yield* SkillService;
        return yield* skill.listWithStatus(resolveWorkspaceCwd(rawCwd));
      })
    );
    if (!result.ok) {
      const { status, body } = errorResponse(result.error);
      return c.json(body, status as any);
    }
    return c.json(
      result.value.map((s) => ({
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
      return yield* skill.listWithStatus(cwd);
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(
    result.value.map((s) => {
      const isFromProject = projectNames.has(s.name);
      const isFromGlobal = globalNames.has(s.name);
      const hasProjectOverride = isFromProject && isFromGlobal;
      return {
        ...s,
        source: isFromProject ? (hasProjectOverride ? 'global' : 'project') : 'global',
        hasProjectOverride,
      };
    })
  );
});

settingsRouter.post('/skills', async (c) => {
  const body = (await c.req.json()) as { name: string; enabled: boolean };
  const rawCwd = c.req.query('cwd');
  if (isGlobalCwd(rawCwd)) {
    setGlobalSkillDisabledState(body.name, !body.enabled);
    return c.json({ ok: true });
  }
  const cwd = resolveWorkspaceCwd(rawCwd);
  setProjectSkillDisabledState(cwd, body.name, !body.enabled);
  return c.json({ ok: true });
});

// ---- Subagent enabled ----
settingsRouter.get('/subagent/enabled', (c) => {
  const rawCwd = c.req.query('cwd');
  if (isGlobalCwd(rawCwd)) {
    return c.json({ enabled: getSubagentEnabledState(), source: 'global' });
  }
  const cwd = resolveWorkspaceCwd(rawCwd);
  const projectVal = getProjectSubagentEnabledState(cwd);
  return c.json({
    enabled: resolveSubagentEnabled(cwd),
    source: projectVal !== undefined ? 'project' : 'global',
  });
});

settingsRouter.post('/subagent/enabled', async (c) => {
  const body = (await c.req.json()) as { enabled: boolean };
  const rawCwd = c.req.query('cwd');
  if (isGlobalCwd(rawCwd)) {
    setSubagentEnabledState(body.enabled);
  } else {
    setProjectSubagentEnabledState(resolveWorkspaceCwd(rawCwd), body.enabled);
  }
  return c.json({ ok: true });
});

settingsRouter.post('/subagent/enabled/reset', async (c) => {
  const rawCwd = c.req.query('cwd');
  resetProjectSubagentEnabledState(resolveWorkspaceCwd(rawCwd));
  return c.json({ ok: true });
});
