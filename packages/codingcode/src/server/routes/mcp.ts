import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { isGlobalCwd, resolveCwd } from '../cwd.js';
import { AlreadyExistsError, NotFoundError, type AppError } from '../http-error.js';
import { AgentError } from '../../core/error.js';
import { json, pathParams, query, readJson, type Handler, type Router } from '../handler.js';
import type { McpServerConfig } from '../../mcp/types.js';
import {
  loadMcpConfig,
  writeMcpConfig,
  loadGlobalMcpConfig,
  writeGlobalMcpConfig,
  resolveMcpConfig,
  setGlobalMcpServerEnabled,
  setProjectMcpServerEnabled,
} from '../../mcp/config.js';

/** POST / PUT body 的线上形状：字段一律可选——请求体是未验证输入，必填项由 toMcpServerConfig 显式校验 */
type McpServerBody = {
  name?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  concurrency?: number;
  autoReconnect?: boolean;
};

/** 校验必填项后构造领域对象；缺 name 返回 null，由调用方落 400。不用 `as` 把未验证 body 断言成 McpServerConfig。 */
function toMcpServerConfig(body: McpServerBody): McpServerConfig | null {
  const { name } = body;
  if (!name) return null;
  return { ...body, name };
}

const MISSING_NAME = 'Missing required field: name';

const mcpCreateServer = (cwd: string, server: McpServerConfig): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const servers = loadMcpConfig(cwd);
    if (servers.some((s) => s.name === server.name)) {
      return yield* Effect.fail(new AlreadyExistsError(`MCP server '${server.name}' already exists`));
    }
    servers.push(server);
    writeMcpConfig(cwd, servers);
  });

const mcpUpdateServer = (
  cwd: string,
  name: string,
  server: McpServerConfig
): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const servers = loadMcpConfig(cwd);
    const idx = servers.findIndex((s) => s.name === name);
    if (idx === -1) return yield* Effect.fail(new NotFoundError(`MCP server '${name}' not found`));
    if (server.name !== name && servers.some((s) => s.name === server.name)) {
      return yield* Effect.fail(new AlreadyExistsError(`MCP server '${server.name}' already exists`));
    }
    servers[idx] = server;
    writeMcpConfig(cwd, servers);
  });

const mcpDeleteServer = (cwd: string, name: string): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const servers = loadMcpConfig(cwd);
    if (!servers.some((s) => s.name === name)) {
      return yield* Effect.fail(new NotFoundError(`MCP server '${name}' not found in project config`));
    }
    writeMcpConfig(
      cwd,
      servers.filter((s) => s.name !== name)
    );
  });

const listServers: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  if (isGlobalCwd(rawCwd)) {
    return json(
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
  return json(
    resolveMcpConfig(cwd).map((s) => {
      const isFromProject = projectNames.has(s.name);
      const isFromGlobal = globalNames.has(s.name);
      return {
        ...s,
        enabled: s.enabled !== false,
        source: isFromProject ? 'project' : 'global',
        hasProjectOverride: isFromProject && isFromGlobal,
      };
    })
  );
});

const createServer: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<McpServerBody>();
  const server = toMcpServerConfig(body);
  if (!server) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_NAME));

  if (isGlobalCwd(rawCwd)) {
    const servers = loadGlobalMcpConfig();
    if (servers.some((s) => s.name === server.name)) {
      return yield* Effect.fail(new AlreadyExistsError(`MCP server '${server.name}' already exists`));
    }
    servers.push(server);
    writeGlobalMcpConfig(servers);
  } else {
    yield* mcpCreateServer(resolveCwd(rawCwd), server);
  }
  return json({ ok: true });
});

const updateServer: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<McpServerBody>();
  const server = toMcpServerConfig(body);
  if (!server) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_NAME));

  const target = name ?? '';
  if (isGlobalCwd(rawCwd)) {
    const servers = loadGlobalMcpConfig();
    const idx = servers.findIndex((s) => s.name === target);
    if (idx === -1) return yield* Effect.fail(new NotFoundError(`MCP server '${target}' not found`));
    if (server.name !== target && servers.some((s) => s.name === server.name)) {
      return yield* Effect.fail(new AlreadyExistsError(`MCP server '${server.name}' already exists`));
    }
    servers[idx] = server;
    writeGlobalMcpConfig(servers);
  } else {
    yield* mcpUpdateServer(resolveCwd(rawCwd), target, server);
  }
  return json({ ok: true });
});

const deleteServer: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const target = name ?? '';
  if (isGlobalCwd(rawCwd)) {
    writeGlobalMcpConfig(loadGlobalMcpConfig().filter((s) => s.name !== target));
  } else {
    yield* mcpDeleteServer(resolveCwd(rawCwd), target);
  }
  return json({ ok: true });
});

// 开关就是配置里的 enabled 字段：改开关 = 写回对应层的 mcp.yaml
const setServerEnabled: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<{ enabled: boolean }>();
  const target = name ?? '';
  if (isGlobalCwd(rawCwd)) {
    setGlobalMcpServerEnabled(target, body.enabled);
  } else {
    setProjectMcpServerEnabled(resolveCwd(rawCwd), target, body.enabled);
  }
  return json({ ok: true });
});

export const addMcpSettingsRoutes = (router: Router): Router =>
  router.pipe(
    HttpRouter.get('/api/settings/mcp', listServers),
    HttpRouter.post('/api/settings/mcp', createServer),
    HttpRouter.put('/api/settings/mcp/:name', updateServer),
    HttpRouter.del('/api/settings/mcp/:name', deleteServer),
    HttpRouter.post('/api/settings/mcp/:name/enabled', setServerEnabled)
  );
