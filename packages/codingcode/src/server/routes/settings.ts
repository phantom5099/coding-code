import { Hono } from 'hono';
import { Effect } from 'effect';
import { McpService } from '../../mcp/index.js';
import { SkillService } from '../../skills/index.js';
import { SubagentRegistry } from '../../subagent/registry.js';
import { getMemoryEnabled, setMemoryEnabled } from '../../memory/index.js';
import { getMemoryConfig, getAllTypesWithStatus, setMemoryTypeDisabled, addMemoryExtraType, updateMemoryExtraType, deleteMemoryExtraType } from '../../memory/config.js';
import { resolveWorkspaceCwd } from '../../core/workspace.js';
import type { McpServerConfig } from '../../mcp/types.js';
import type { SubagentProfile } from '../../subagent/registry.js';
import type { UserHookConfig } from '../../hooks/config.js';
import * as settingsService from '../../settings/service.js';
import { AlreadyExistsError, NotFoundError } from '../../settings/service.js';
import { runWithLayer, errorResponse } from '../util.js';

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
  return c.json(settingsService.listAgents(cwd));
});

settingsRouter.post('/agents', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as SubagentProfile;
  try {
    settingsService.createAgent(cwd, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.put('/agents/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as SubagentProfile;
  try {
    settingsService.updateAgent(cwd, name, body);
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
  settingsService.deleteAgent(cwd, name);
  return c.json({ ok: true });
});

settingsRouter.post('/agents/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json() as { disabled: boolean };
  settingsService.setAgentDisabled(name, body.disabled);
  return c.json({ ok: true });
});

// ---- Hooks ----
settingsRouter.get('/hooks', (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  return c.json(settingsService.listHooks(cwd));
});

settingsRouter.post('/hooks', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as UserHookConfig;
  try {
    settingsService.createHook(cwd, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.put('/hooks/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as UserHookConfig;
  try {
    settingsService.updateHook(cwd, name, body);
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
  settingsService.deleteHook(cwd, name);
  return c.json({ ok: true });
});

settingsRouter.post('/hooks/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json() as { disabled: boolean };
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  settingsService.setHookDisabled(cwd, name, body.disabled);
  return c.json({ ok: true });
});

// ---- MCP ----
settingsRouter.get('/mcp', async (c) => {
  const result = await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* mcp.status();
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

settingsRouter.post('/mcp', async (c) => {
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as McpServerConfig;
  try {
    settingsService.createMcpServer(cwd, body);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: e.message }, 409);
    throw e;
  }
});

settingsRouter.put('/mcp/:name', async (c) => {
  const name = c.req.param('name');
  const cwd = resolveWorkspaceCwd(c.req.query('cwd'));
  const body = await c.req.json() as McpServerConfig;
  try {
    settingsService.updateMcpServer(cwd, name, body);
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
  settingsService.deleteMcpServer(cwd, name);
  return c.json({ ok: true });
});

settingsRouter.post('/mcp/:name/disabled', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json() as { disabled: boolean };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const mcp = yield* McpService;
      return yield* (body.disabled ? mcp.disable(name) : mcp.enable(name));
    }),
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
      return yield* skill.listWithStatus();
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json(result.value);
});

settingsRouter.post('/skills', async (c) => {
  const body = await c.req.json() as { name: string; enabled: boolean };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const skill = yield* SkillService;
      return yield* (body.enabled ? skill.enableSkill(body.name) : skill.disableSkill(body.name));
    }),
  );
  if (!result.ok) {
    const { status, body: resp } = errorResponse(result.error);
    return c.json(resp, status as any);
  }
  return c.json({ ok: true });
});

// ---- Subagent enabled ----
settingsRouter.get('/subagent/enabled', async (c) => {
  const result = await runWithLayer(
    Effect.gen(function* () {
      const registry = yield* SubagentRegistry;
      return registry.isEnabled();
    }),
  );
  if (!result.ok) {
    const { status, body } = errorResponse(result.error);
    return c.json(body, status as any);
  }
  return c.json({ enabled: result.value });
});

settingsRouter.post('/subagent/enabled', async (c) => {
  const body = await c.req.json() as { enabled: boolean };
  const result = await runWithLayer(
    Effect.gen(function* () {
      const registry = yield* SubagentRegistry;
      registry.setEnabled(body.enabled);
    }),
  );
  if (!result.ok) {
    const { status, body: resp } = errorResponse(result.error);
    return c.json(resp, status as any);
  }
  return c.json({ ok: true });
});
