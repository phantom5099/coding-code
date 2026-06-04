import { Hono } from 'hono';
import { Effect } from 'effect';
import { McpService } from '../../mcp/index.js';
import { SkillService } from '../../skills/index.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import { AlreadyExistsError, NotFoundError } from '../../core/error.js';
import type { McpServerConfig } from '../../mcp/types.js';
import type { AgentProfile } from '../../subagent/registry.js';
import type { UserHookConfig } from '../../hooks/config.js';
import { loadMcpConfig, writeMcpConfig } from '../../mcp/config.js';
import {
  loadAgentProfiles,
  writeAgentProfile,
  updateAgentProfile,
  deleteAgentProfile,
} from '../../subagent/loader.js';
import {
  EXPLORE_PROFILE,
  isAgentDisabledState,
  setAgentDisabledState,
  getSubagentEnabledState,
  setSubagentEnabledState,
} from '../../subagent/registry.js';
import { loadHookConfigs, writeHookConfigs } from '../../hooks/config.js';
import { setHookRuntimeEnabled } from '../../hooks/executor.js';
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
}> {
  const custom = loadAgentProfiles(cwd);
  return [EXPLORE_PROFILE, ...custom].map((a) => ({
    name: a.name,
    description: a.description,
    tools: a.tools,
    mcpServers: a.mcpServers,
    readonly: a.readonly,
    maxSteps: a.maxSteps,
    model: a.model,
    disabled: isAgentDisabledState(a.name),
  }));
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

function hooksSetDisabled(cwd: string, name: string, disabled: boolean): void {
  setHookRuntimeEnabled(name, !disabled);
  const hooks = loadHookConfigs(cwd);
  const hook = hooks.find((h) => h.name === name);
  if (hook) {
    hook.enabled = !disabled;
    writeHookConfigs(cwd, hooks);
  }
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
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  return c.json(agentsList(cwd));
});

settingsRouter.post('/agents', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = (await c.req.json()) as AgentProfile;
  try {
    agentsCreate(cwd, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.put('/agents/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = (await c.req.json()) as AgentProfile;
  try {
    agentsUpdate(cwd, name, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.delete('/agents/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  deleteAgentProfile(cwd, name);
  return c.json({ ok: true });
});

settingsRouter.post('/agents/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = (await c.req.json()) as { disabled: boolean };
  setAgentDisabledState(name, body.disabled);
  return c.json({ ok: true });
});

// ---- Hooks ----
settingsRouter.get('/hooks', (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  return c.json(loadHookConfigs(cwd));
});

settingsRouter.post('/hooks', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = (await c.req.json()) as UserHookConfig;
  try {
    hooksCreate(cwd, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.put('/hooks/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = (await c.req.json()) as UserHookConfig;
  try {
    hooksUpdate(cwd, name, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.delete('/hooks/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  hooksDelete(cwd, name);
  return c.json({ ok: true });
});

settingsRouter.post('/hooks/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = (await c.req.json()) as { disabled: boolean };
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  hooksSetDisabled(cwd, name, body.disabled);
  return c.json({ ok: true });
});

// ---- MCP ----
settingsRouter.get('/mcp', async (c) => {
  const result = await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* mcp.status(resolveWorkspaceCwd(c.req.query('cwd')));
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

settingsRouter.post('/mcp', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = (await c.req.json()) as McpServerConfig;
  try {
    mcpCreateServer(cwd, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.put('/mcp/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = (await c.req.json()) as McpServerConfig;
  try {
    mcpUpdateServer(cwd, name, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: e.message }, 404);
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.delete('/mcp/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  mcpDeleteServer(cwd, name);
  return c.json({ ok: true });
});

settingsRouter.post('/mcp/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = (await c.req.json()) as { disabled: boolean };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* body.disabled
        ? mcp.disable(resolveWorkspaceCwd(c.req.query('cwd')), name)
        : mcp.enable(resolveWorkspaceCwd(c.req.query('cwd')), name);
    })
  );
  if (!result.ok) {
    const { status, body: resp } = errorResponse(result.error);
    return c.json(resp, status as any);
  }
  return c.json({ ok: true });
});

// ---- Skills ----
settingsRouter.get('/skills', async (c) => {
  const result = await runWithLayer(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.listWithStatus(resolveWorkspaceCwd(c.req.query('cwd')));
    })
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

settingsRouter.post('/skills', async (c) => {
  const body = (await c.req.json()) as { name: string; enabled: boolean };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
      return yield* body.enabled
        ? skill.enableSkill(cwd, body.name)
        : skill.disableSkill(cwd, body.name);
    })
  );
  if (!result.ok) {
    const { status, body: resp } = errorResponse(result.error);
    return c.json(resp, status as any);
  }
  return c.json({ ok: true });
});

// ---- Subagent enabled ----
settingsRouter.get('/subagent/enabled', (c) => {
  return c.json({ enabled: getSubagentEnabledState() });
});

settingsRouter.post('/subagent/enabled', async (c) => {
  const body = (await c.req.json()) as { enabled: boolean };
  setSubagentEnabledState(body.enabled);
  return c.json({ ok: true });
});
