import { Effect, Layer } from 'effect';
import {
  loadMcpConfig,
  resolveMcpConfig,
  setMcpServerEnabledConfig,
  writeMcpConfig,
} from './config.js';
import { McpClient } from './client.js';
import { McpService } from './port.js';
import type {
  CreateMcpServerCommand,
  DeleteMcpServerCommand,
  McpConfigOutcome,
  McpRawTool,
  McpServerConfig,
  McpServerEntry,
  McpToolSpec,
  SetMcpServerEnabledCommand,
  UpdateMcpServerCommand,
} from './types.js';
import { createLogger } from '@codingcode/infra';
import { AgentError, GLOBAL_CONFIG_SCOPE, type ConfigScope } from '@codingcode/util';

const logger = createLogger();

interface ServerEntry {
  readonly client: McpClient;
  readonly rawTools: readonly McpRawTool[];
}

export const McpLayer = Layer.effect(
  McpService,
  Effect.sync(() => {
    const clientsByProject = new Map<string, Map<string, ServerEntry>>();

    function getProjectClients(projectPath: string): Map<string, ServerEntry> {
      let map = clientsByProject.get(projectPath);
      if (!map) {
        map = new Map();
        clientsByProject.set(projectPath, map);
      }
      return map;
    }

    function disabledServerNames(projectPath: string): Set<string> {
      return new Set(
        resolveMcpConfig(projectPath)
          .filter((c) => c.enabled === false)
          .map((c) => c.name)
      );
    }

    function doConnect(target: {
      readonly projectPath: string;
      readonly config: McpServerConfig;
    }): Effect.Effect<void> {
      return Effect.gen(function* () {
        const { projectPath, config } = target;
        const projectClients = getProjectClients(projectPath);
        if (projectClients.has(config.name)) return;

        const result = yield* Effect.tryPromise(async () => {
          const client = new McpClient(config);
          await client.connect();
          const rawTools = await client.listTools();
          return { client, rawTools };
        }).pipe(
          Effect.catchAll((err) => {
            logger.error(
              `[MCP] Failed to connect to '${config.name}' for project '${projectPath}': ${String(err)}`
            );
            return Effect.succeed(undefined);
          })
        );

        if (!result) return;
        projectClients.set(config.name, result);
      });
    }

    function doDisconnect(target: {
      readonly projectPath: string;
      readonly serverName: string;
    }): Effect.Effect<void> {
      return Effect.gen(function* () {
        const { projectPath, serverName } = target;
        const projectClients = clientsByProject.get(projectPath);
        if (!projectClients) return;
        const entry = projectClients.get(serverName);
        if (!entry) return;

        yield* Effect.tryPromise(() => entry.client.disconnect()).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        );

        projectClients.delete(serverName);
        if (projectClients.size === 0) {
          clientsByProject.delete(projectPath);
        }
      });
    }

    /** 开关归一：缺省（undefined）等同启用 */
    function enabledOf(server: McpServerConfig): McpServerConfig & { enabled: boolean } {
      return { ...server, enabled: server.enabled !== false };
    }

    return {
      syncConnections: (projectPath: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const configs = resolveMcpConfig(projectPath);
          const configNames = new Set(configs.map((c) => c.name));

          const projectClients = clientsByProject.get(projectPath);
          if (projectClients) {
            for (const [serverName] of projectClients) {
              if (!configNames.has(serverName)) {
                yield* doDisconnect({ projectPath, serverName });
              }
            }
          }

          for (const config of configs) {
            if (config.enabled === false) {
              yield* doDisconnect({ projectPath, serverName: config.name });
              continue;
            }
            yield* doConnect({ projectPath, config });
          }
        }),

      listProjectMcpTools: (projectPath: string): Effect.Effect<McpToolSpec[]> =>
        Effect.sync(() => {
          const projectClients = clientsByProject.get(projectPath);
          if (!projectClients) return [];
          const disabled = disabledServerNames(projectPath);
          const specs: McpToolSpec[] = [];
          for (const [serverName, entry] of projectClients) {
            if (disabled.has(serverName)) continue;
            for (const tool of entry.rawTools) {
              specs.push(
                mcpToolToSpec({
                  serverName,
                  tool,
                  client: entry.client,
                  isDisabled: () => disabledServerNames(projectPath).has(serverName),
                })
              );
            }
          }
          return specs;
        }),

      listServers: (scope: ConfigScope): Effect.Effect<McpServerEntry[]> =>
        Effect.sync(() => {
          const globalServers = loadMcpConfig(GLOBAL_CONFIG_SCOPE);
          if (scope.kind === 'global') {
            return globalServers.map((s) => ({ ...enabledOf(s), source: 'global' as const }));
          }
          const projectServers = loadMcpConfig(scope);
          const globalNames = new Set(globalServers.map((s) => s.name));
          const projectNames = new Set(projectServers.map((s) => s.name));
          return resolveMcpConfig(scope.projectPath).map((s) => {
            const isFromProject = projectNames.has(s.name);
            const isFromGlobal = globalNames.has(s.name);
            return {
              ...enabledOf(s),
              source: isFromProject ? ('project' as const) : ('global' as const),
              hasProjectOverride: isFromProject && isFromGlobal,
            };
          });
        }),

      createServer: (cmd: CreateMcpServerCommand): Effect.Effect<McpConfigOutcome> =>
        Effect.sync(() => {
          const servers = loadMcpConfig(cmd.scope);
          if (servers.some((s) => s.name === cmd.server.name)) {
            return { ok: false, reason: 'already-exists' } as const;
          }
          servers.push(cmd.server);
          writeMcpConfig(cmd.scope, servers);
          return { ok: true } as const;
        }),

      updateServer: (cmd: UpdateMcpServerCommand): Effect.Effect<McpConfigOutcome> =>
        Effect.sync(() => {
          const servers = loadMcpConfig(cmd.scope);
          const idx = servers.findIndex((s) => s.name === cmd.name);
          if (idx === -1) return { ok: false, reason: 'not-found' } as const;
          if (cmd.server.name !== cmd.name && servers.some((s) => s.name === cmd.server.name)) {
            return { ok: false, reason: 'already-exists' } as const;
          }
          servers[idx] = cmd.server;
          writeMcpConfig(cmd.scope, servers);
          return { ok: true } as const;
        }),

      deleteServer: (cmd: DeleteMcpServerCommand): Effect.Effect<McpConfigOutcome> =>
        Effect.sync(() => {
          const servers = loadMcpConfig(cmd.scope);
          if (cmd.scope.kind === 'project' && !servers.some((s) => s.name === cmd.name)) {
            return { ok: false, reason: 'not-found' } as const;
          }
          writeMcpConfig(
            cmd.scope,
            servers.filter((s) => s.name !== cmd.name)
          );
          return { ok: true } as const;
        }),

      setServerEnabled: (cmd: SetMcpServerEnabledCommand): Effect.Effect<void> =>
        Effect.sync(() => setMcpServerEnabledConfig(cmd)),
    };
  })
);

function mcpToolToSpec(input: {
  readonly serverName: string;
  readonly tool: McpRawTool;
  readonly client: McpClient;
  readonly isDisabled: () => boolean;
}): McpToolSpec {
  const { serverName, tool, client, isDisabled } = input;
  return {
    server: serverName,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    readOnlyHint: Boolean(tool.readOnlyHint),
    execute: (args) => {
      if (isDisabled())
        return Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', `MCP server '${serverName}' is disabled`)
        );
      return client.callTool(tool.name, args).pipe(
        Effect.catchAll((err) =>
          Effect.fail(
            new AgentError('TOOL_EXECUTION_FAILED', `MCP tool '${tool.name}' failed: ${String(err)}`, {
              cause: err,
            })
          )
        )
      );
    },
  };
}
