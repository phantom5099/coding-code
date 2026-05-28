import { Hono } from 'hono';
import { Effect } from 'effect';
import { AppLayer } from '../../layer.js';
import { McpService } from '../../mcp/index.js';
import { SkillService } from '../../skills/index.js';
import { SubagentRegistry, EXPLORE_PROFILE, isAgentDisabledState, setAgentDisabledState } from '../../subagent/registry.js';
import { loadAgentProfiles, writeAgentProfile, updateAgentProfile, deleteAgentProfile } from '../../subagent/loader.js';
import { getMemoryEnabled, setMemoryEnabled } from '../../memory/index.js';
import { getMemoryConfig, getAllTypesWithStatus, setMemoryTypeDisabled, addMemoryExtraType, updateMemoryExtraType, deleteMemoryExtraType } from '../../memory/config.js';
import { loadHookConfigs, writeHookConfigs } from '../../hooks/config.js';
import { loadMcpConfig, writeMcpConfig } from '../../mcp/config.js';
import { setHookRuntimeEnabled } from '../../hooks/executor.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import type { UserHookConfig } from '../../hooks/config.js';
import type { McpServerConfig } from '../../mcp/types.js';
import type { SubagentProfile } from '../../subagent/registry.js';

function runWithLayer<T>(eff: Effect.Effect<T, any, any>): Promise<T> {
  return Effect.runPromise(eff.pipe(Effect.provide(AppLayer) as any));
}

export const settingsRouter = new Hono();

// ---- Memory ----
settingsRouter.get('/memory/config', (c) => {
  const cfg = getMemoryConfig();
  return c.json({ enabled: cfg.enabled, types: getAllTypesWithStatus(cfg) });
});

settingsRouter.post('/memory/enabled', async (c) => {
  const body = await c.req.json() as { enabled: boolean };
  setMemoryEnabled(body.enabled);
  return c.json({ enabled: getMemoryEnabled() });
});

settingsRouter.post('/memory/type-disabled', async (c) => {
  const body = await c.req.json() as { name: string; disabled: boolean };
  setMemoryTypeDisabled(body.name, body.disabled);
  return c.json({ ok: true });
});

settingsRouter.post('/memory/extra-type', async (c) => {
  const body = await c.req.json() as { name: string; description: string };
  addMemoryExtraType({ name: body.name, description: body.description, enabled: true });
  return c.json({ ok: true });
});

settingsRouter.put('/memory/extra-type/:name', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json() as { name: string; description: string };
  updateMemoryExtraType(name, { name: body.name, description: body.description, enabled: true });
  return c.json({ ok: true });
});

settingsRouter.delete('/memory/extra-type/:name', async (c) => {
  const name = c.req.param('name');
  deleteMemoryExtraType(name);
  return c.json({ ok: true });
});

// ---- Agents ----
settingsRouter.get('/agents', (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const custom = loadAgentProfiles(cwd);
  const all = [EXPLORE_PROFILE, ...custom].map(a => ({
    name: a.name, description: a.description, tools: a.tools,
    mcpServers: a.mcpServers, readonly: a.readonly, maxSteps: a.maxSteps,
    model: a.model, disabled: isAgentDisabledState(a.name),
  }));
  return c.json(all);
});

settingsRouter.post('/agents', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as SubagentProfile;
  const existing = loadAgentProfiles(cwd);
  if (existing.some(a => a.name === body.name)) {
    return c.json({ error: `Agent '${body.name}' already exists` }, 409);
  }
  writeAgentProfile(cwd, body);
  return c.json({ ok: true });
});

settingsRouter.put('/agents/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as SubagentProfile;
  const existing = loadAgentProfiles(cwd);
  if (!existing.some(a => a.name === name)) {
    return c.json({ error: `Agent '${name}' not found` }, 404);
  }
  if (body.name !== name && existing.some(a => a.name === body.name)) {
    return c.json({ error: `Agent '${body.name}' already exists` }, 409);
  }
  updateAgentProfile(cwd, name, body);
  return c.json({ ok: true });
});

settingsRouter.delete('/agents/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  deleteAgentProfile(cwd, name);
  return c.json({ ok: true });
});

settingsRouter.post('/agents/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json() as { disabled: boolean };
  setAgentDisabledState(name, body.disabled);
  return c.json({ ok: true });
});

// ---- Hooks ----
settingsRouter.get('/hooks', (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const hooks = loadHookConfigs(cwd);
  return c.json(hooks);
});

settingsRouter.post('/hooks', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as UserHookConfig;
  const hooks = loadHookConfigs(cwd);
  if (hooks.some(h => h.name === body.name)) {
    return c.json({ error: `Hook '${body.name}' already exists` }, 409);
  }
  hooks.push(body);
  writeHookConfigs(cwd, hooks);
  return c.json({ ok: true });
});

settingsRouter.put('/hooks/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as UserHookConfig;
  const hooks = loadHookConfigs(cwd);
  const idx = hooks.findIndex(h => h.name === name);
  if (idx === -1) {
    return c.json({ error: `Hook '${name}' not found` }, 404);
  }
  if (body.name !== name && hooks.some(h => h.name === body.name)) {
    return c.json({ error: `Hook '${body.name}' already exists` }, 409);
  }
  hooks[idx] = body;
  writeHookConfigs(cwd, hooks);
  return c.json({ ok: true });
});

settingsRouter.delete('/hooks/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const hooks = loadHookConfigs(cwd).filter(h => h.name !== name);
  writeHookConfigs(cwd, hooks);
  return c.json({ ok: true });
});

settingsRouter.post('/hooks/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json() as { disabled: boolean };
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  setHookRuntimeEnabled(name, !body.disabled);
  const hooks = loadHookConfigs(cwd);
  const hook = hooks.find(h => h.name === name);
  if (hook) {
    hook.enabled = !body.disabled;
    writeHookConfigs(cwd, hooks);
  }
  return c.json({ ok: true });
});

// ---- MCP ----
settingsRouter.get('/mcp', async (c) => {
  const status = await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* mcp.status();
    }),
  );
  return c.json(status);
});

settingsRouter.post('/mcp', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as McpServerConfig;
  const servers = loadMcpConfig(cwd);
  if (servers.some(s => s.name === body.name)) {
    return c.json({ error: `MCP server '${body.name}' already exists` }, 409);
  }
  servers.push(body);
  writeMcpConfig(cwd, servers);
  return c.json({ ok: true });
});

settingsRouter.put('/mcp/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as McpServerConfig;
  const servers = loadMcpConfig(cwd);
  const idx = servers.findIndex(s => s.name === name);
  if (idx === -1) {
    return c.json({ error: `MCP server '${name}' not found` }, 404);
  }
  if (body.name !== name && servers.some(s => s.name === body.name)) {
    return c.json({ error: `MCP server '${body.name}' already exists` }, 409);
  }
  servers[idx] = body;
  writeMcpConfig(cwd, servers);
  return c.json({ ok: true });
});

settingsRouter.delete('/mcp/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const servers = loadMcpConfig(cwd).filter(s => s.name !== name);
  writeMcpConfig(cwd, servers);
  return c.json({ ok: true });
});

settingsRouter.post('/mcp/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json() as { disabled: boolean };
  await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* (body.disabled ? mcp.disable(name) : mcp.enable(name));
    }),
  );
  return c.json({ ok: true });
});

// ---- Skills (also available at /api/agent/skills, kept for backward compat with existing clients) ----
settingsRouter.get('/skills', async (c) => {
  const skills = await runWithLayer(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* skill.listWithStatus();
    }),
  );
  return c.json(skills);
});

settingsRouter.post('/skills', async (c) => {
  const body = await c.req.json() as { name: string; enabled: boolean };
  await runWithLayer(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* (body.enabled ? skill.enableSkill(body.name) : skill.disableSkill(body.name));
    }),
  );
  return c.json({ ok: true });
});

// ---- Subagent enabled ----
settingsRouter.get('/subagent/enabled', async (c) => {
  const enabled = await runWithLayer(
    Effect.gen(function* () {
      const registry = yield* SubagentRegistry;
      return registry.isEnabled();
    }),
  );
  return c.json({ enabled });
});

settingsRouter.post('/subagent/enabled', async (c) => {
  const body = await c.req.json() as { enabled: boolean };
  await runWithLayer(
    Effect.gen(function* () {
      const registry = yield* SubagentRegistry;
      registry.setEnabled(body.enabled);
    }),
  );
  return c.json({ ok: true });
});
