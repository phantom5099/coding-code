import * as HttpRouter from '@effect/platform/HttpRouter';
import { Effect } from 'effect';
import { isGlobalCwd, resolveCwd } from '../cwd.js';
import { AlreadyExistsError, NotFoundError } from '../http-error.js';
import { AgentError } from '../../util/error.js';
import { json, pathParams, query, readJson, type Handler, type Router } from '../handler.js';
import { McpService } from '../../mcp/port.js';
import type { McpServerConfig } from '../../mcp/types.js';

/** 校验必填项后构造领域对象；缺 name 返回 null，由调用方落 400。不用 `as` 把未验证 body 断言成 McpServerConfig。 */
function toMcpServerConfig(body: Partial<McpServerConfig>): McpServerConfig | null {
  const { name } = body;
  if (!name) return null;
  return { ...body, name };
}

const MISSING_NAME = 'Missing required field: name';

/** `?cwd` 约定 → 模块入参：空 / global 即全局层（undefined） */
const scopeOf = (rawCwd: string | undefined): string | undefined =>
  isGlobalCwd(rawCwd) ? undefined : resolveCwd(rawCwd);

const listServers: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const mcp = yield* McpService;
  return json(yield* mcp.listServers(scopeOf(rawCwd)));
});

const createServer: Handler = Effect.gen(function* () {
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<Partial<McpServerConfig>>();
  const server = toMcpServerConfig(body);
  if (!server) return yield* Effect.fail(new AgentError('CONFIG_MISSING', MISSING_NAME));

  const mcp = yield* McpService;
  const outcome = yield* mcp.createServer(scopeOf(rawCwd), server);
  if (!outcome.ok) {
    return yield* Effect.fail(new AlreadyExistsError(`MCP server '${server.name}' already exists`));
  }
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
  const outcome = yield* mcp.updateServer(scopeOf(rawCwd), target, server);
  if (!outcome.ok) {
    return yield* Effect.fail(
      outcome.reason === 'already-exists'
        ? new AlreadyExistsError(`MCP server '${server.name}' already exists`)
        : new NotFoundError(`MCP server '${target}' not found`)
    );
  }
  return json({ ok: true });
});

const deleteServer: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const target = name ?? '';

  const mcp = yield* McpService;
  const outcome = yield* mcp.deleteServer(scopeOf(rawCwd), target);
  if (!outcome.ok) {
    return yield* Effect.fail(
      new NotFoundError(`MCP server '${target}' not found in project config`)
    );
  }
  return json({ ok: true });
});

const setServerEnabled: Handler = Effect.gen(function* () {
  const { name } = yield* pathParams;
  const { cwd: rawCwd } = yield* query;
  const body = yield* readJson<{ enabled: boolean }>();

  const mcp = yield* McpService;
  yield* mcp.setServerEnabled(scopeOf(rawCwd), name ?? '', body.enabled);
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
