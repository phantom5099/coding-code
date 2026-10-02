import type { Hono } from 'hono';
import { isGlobalCwd, resolveCwd } from '../../core/path.js';
import { AlreadyExistsError, NotFoundError } from '../../contracts/error.js';
import type { McpServerConfig } from '../../contracts/mcp.js';
import {
  loadMcpConfig,
  writeMcpConfig,
  loadGlobalMcpConfig,
  writeGlobalMcpConfig,
  resolveMcpConfig,
  setGlobalMcpServerEnabled,
  setProjectMcpServerEnabled,
} from '../../mcp/config.js';

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

export function registerMcpSettingsRoutes(router: Hono): void {
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
  });

  router.put('/api/settings/mcp/:name', async (c) => {
    const name = c.req.param('name');
    const rawCwd = c.req.query('cwd');
    const body = (await c.req.json()) as McpServerConfig;
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
}
