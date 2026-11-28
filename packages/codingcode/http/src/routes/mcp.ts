import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { resolveConfigScope } from '../cwd.js';
import { unwrapConfigOutcome } from '../http-error.js';
import { AgentError } from '@codingcode/util';
import { json, pathParams, query, readJson, type Handler, type Router } from '../handler.js';
import { McpService, type McpServerConfig } from '@codingcode/mcp';

function toMcpServerConfig(body: Partial<McpServerConfig>): McpServerConfig | null {
  const { name } = body;
  if (!name) return null;
  return {
    name,
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.command !== undefined ? { command: body.command } : {}),
    ...(body.args !== undefined ? { args: body.args } : {}),
    ...(body.env !== undefined ? { env: body.env } : {}),
    ...(body.url !== undefined ? { url: body.url } : {}),
    ...(body.headers !== undefined ? { headers: body.headers } : {}),
    ...(body.concurrency !== undefined ? { concurrency: body.concurrency } : {}),
    ...(body.autoReconnect !== undefined ? { autoReconnect: body.autoReconnect } : {}),
  };
}

const MISSING_NAME = 'Missing required field: name';

const listServers: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const mcp = yield* McpService;
  return json(yield* mcp.listServers(resolveConfigScope(rawCwd)));
});

const createServer: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<Partial<McpServerConfig>>();
  const server = toMcpServerConfig(body);
  if (!server) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_NAME));

  const mcp = yield* McpService;
  const outcome = yield* mcp.createServer({ scope: resolveConfigScope(rawCwd), server });
  yield* unwrapConfigOutcome(outcome, {
    alreadyExists: `MCP server '${server.name}' already exists`,
    notFound: `MCP server '${server.name}' not found`,
  });
  return json({ ok: true });
});

const updateServer: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<Partial<McpServerConfig>>();
  const server = toMcpServerConfig(body);
  if (!server) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_NAME));

  const target = name ?? '';
  const mcp = yield* McpService;
  const outcome = yield* mcp.updateServer({
    scope: resolveConfigScope(rawCwd),
    name: target,
    server,
  });
  yield* unwrapConfigOutcome(outcome, {
    alreadyExists: `MCP server '${server.name}' already exists`,
    notFound: `MCP server '${target}' not found`,
  });
  return json({ ok: true });
});

const deleteServer: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const target = name ?? '';

  const mcp = yield* McpService;
  const outcome = yield* mcp.deleteServer({ scope: resolveConfigScope(rawCwd), name: target });
  yield* unwrapConfigOutcome(outcome, {
    alreadyExists: `MCP server '${target}' already exists`,
    notFound: `MCP server '${target}' not found in project config`,
  });
  return json({ ok: true });
});

const setServerEnabled: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<{ enabled: boolean }>();

  const mcp = yield* McpService;
  yield* mcp.setServerEnabled({
    scope: resolveConfigScope(rawCwd),
    name: name ?? '',
    enabled: body.enabled,
  });
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
