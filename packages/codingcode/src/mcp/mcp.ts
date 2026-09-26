import { Effect, Layer } from 'effect';
import { resolveMcpConfig } from './config.js';
import { McpClient } from './client.js';
import { McpService } from './port.js';
import type { McpServerConfig, McpStatus, McpToolSpec } from '../contracts/mcp.js';
import { createLogger } from '@codingcode/infra/logger';
import { AgentError } from '../core/error.js';

const logger = createLogger();

interface McpRawTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint: boolean;
}

interface ServerEntry {
  client: McpClient;
  config: McpServerConfig;
  toolNames: string[];
  rawTools: McpRawTool[];
}

interface LeaseEntry {
  projectPath: string;
  serverName: string;
}

type ProjectPath = string;
type ServerName = string;

export const McpLayer = Layer.effect(McpService, Effect.sync(() => {
    const clientsByProject = new Map<ProjectPath, Map<ServerName, ServerEntry>>();
    const leasesBySession = new Map<string, Set<LeaseEntry>>();

    function getProjectClients(projectPath: string): Map<ServerName, ServerEntry> {
      let map = clientsByProject.get(projectPath);
      if (!map) {
        map = new Map();
        clientsByProject.set(projectPath, map);
      }
      return map;
    }

    function disabledServerNames(projectPath: string): Set<ServerName> {
      return new Set(
        resolveMcpConfig(projectPath)
          .filter((c) => c.enabled === false)
          .map((c) => c.name)
      );
    }

    function doConnect(
      cfg: McpServerConfig,
      projectPath: string,
      bumpRef: boolean,
      sessionId?: string
    ): Effect.Effect<string[]> {
      return Effect.gen(function* () {
        const projectClients = getProjectClients(projectPath);
        const existing = projectClients.get(cfg.name);
        if (existing) {
          if (bumpRef && sessionId) {
            addLease(sessionId, projectPath, cfg.name);
          }
          return existing.toolNames;
        }

        const result = yield* Effect.tryPromise(async () => {
          const client = new McpClient(cfg);
          await client.connect();
          const mcpTools = await client.listTools();
          return { client, mcpTools };
        }).pipe(
          Effect.catchAll((err) => {
            logger.error(
              `[MCP] Failed to connect to '${cfg.name}' for project '${projectPath}': ${String(err)}`
            );
            return Effect.succeed(undefined);
          })
        );

        if (!result) return [];

        const rawTools: McpRawTool[] = result.mcpTools.map((mt: any) => ({
          name: mt.name,
          description: mt.description ?? '',
          inputSchema: mt.inputSchema ?? {},
          readOnlyHint: mt.readOnlyHint ?? false,
        }));

        const registeredNames: string[] = rawTools.map((mt) => namespacedName(cfg.name, mt.name));

        projectClients.set(cfg.name, {
          client: result.client,
          config: cfg,
          toolNames: registeredNames,
          rawTools,
        });

        if (bumpRef && sessionId) {
          addLease(sessionId, projectPath, cfg.name);
        }

        return registeredNames;
      });
    }

    function doDisconnect(projectPath: string, name: string, force: boolean): Effect.Effect<void> {
      return Effect.gen(function* () {
        const projectClients = clientsByProject.get(projectPath);
        if (!projectClients) return;
        const entry = projectClients.get(name);
        if (!entry) return;

        if (!force) {
          if (hasActiveLeases(projectPath, name)) return;
        }

        yield* Effect.tryPromise(() => entry.client.disconnect()).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        );

        projectClients.delete(name);
        if (projectClients.size === 0) {
          clientsByProject.delete(projectPath);
        }
      });
    }

    function addLease(sessionId: string, projectPath: string, serverName: string): void {
      let leases = leasesBySession.get(sessionId);
      if (!leases) {
        leases = new Set();
        leasesBySession.set(sessionId, leases);
      }
      leases.add({ projectPath, serverName });
    }

    function removeLease(sessionId: string, projectPath: string, serverName: string): void {
      const leases = leasesBySession.get(sessionId);
      if (!leases) return;
      for (const lease of leases) {
        if (lease.projectPath === projectPath && lease.serverName === serverName) {
          leases.delete(lease);
          break;
        }
      }
      if (leases.size === 0) {
        leasesBySession.delete(sessionId);
      }
    }

    function hasActiveLeases(projectPath: string, serverName: string): boolean {
      for (const [, leases] of leasesBySession) {
        for (const lease of leases) {
          if (lease.projectPath === projectPath && lease.serverName === serverName) {
            return true;
          }
        }
      }
      return false;
    }

    function countLeases(projectPath: string, serverName: string): number {
      let count = 0;
      for (const [, leases] of leasesBySession) {
        for (const lease of leases) {
          if (lease.projectPath === projectPath && lease.serverName === serverName) {
            count++;
          }
        }
      }
      return count;
    }

    return {
      syncConnections: (projectPath: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const configs = resolveMcpConfig(projectPath);
          const configNames = new Set(configs.map((c) => c.name));

          const projectClients = clientsByProject.get(projectPath);
          if (projectClients) {
            for (const [name] of projectClients) {
              if (!configNames.has(name)) {
                yield* doDisconnect(projectPath, name, true);
              }
            }
          }

          for (const cfg of configs) {
            if (cfg.enabled === false) {
              yield* doDisconnect(projectPath, cfg.name, true);
              continue;
            }
            yield* doConnect(cfg, projectPath, false);
          }
        }),

      connectServers: (
        projectPath: string,
        sessionId: string,
        names: string[]
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const configs = resolveMcpConfig(projectPath);
          const configMap = new Map(configs.map((c) => [c.name, c]));

          for (const name of names) {
            const cfg = configMap.get(name);
            if (!cfg) {
              logger.warn(
                `[MCP] Server '${name}' not found in mcp.yaml for project '${projectPath}', skipping`
              );
              continue;
            }
            if (cfg.enabled === false) continue;
            yield* doConnect(cfg, projectPath, true, sessionId);
          }
        }),

      disconnectServers: (
        projectPath: string,
        sessionId: string,
        names: string[]
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          for (const name of names) {
            removeLease(sessionId, projectPath, name);
            yield* doDisconnect(projectPath, name, false);
          }
        }),

      getServerToolNames: (projectPath: string, name: string): string[] => {
        const projectClients = clientsByProject.get(projectPath);
        if (!projectClients) return [];
        const entry = projectClients.get(name);
        return entry ? [...entry.toolNames] : [];
      },

      listProjectMcpTools: (projectPath: string): Effect.Effect<McpToolSpec[]> =>
        Effect.sync(() => {
          const projectClients = clientsByProject.get(projectPath);
          if (!projectClients) return [];
          const disabled = disabledServerNames(projectPath);
          const specs: McpToolSpec[] = [];
          for (const [serverName, entry] of projectClients) {
            if (disabled.has(serverName)) continue;
            for (const raw of entry.rawTools) {
              specs.push(
                mcpToolToSpec(serverName, raw, entry.client, () =>
                  disabledServerNames(projectPath).has(serverName)
                )
              );
            }
          }
          return specs;
        }),

      status: (projectPath: string): Effect.Effect<McpStatus[]> =>
        Effect.sync(() => {
          const projectClients = clientsByProject.get(projectPath);
          if (!projectClients) return [];
          return Array.from(projectClients.entries()).map(([name, entry]) => ({
            name,
            connected: entry.client.connected,
            toolCount: entry.rawTools.length,
            transport: entry.client.transportType,
            reconnectAttempts: 0,
            leaseCount: countLeases(projectPath, name),
          }));
        }),

      disposeSession: (sessionId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const leases = leasesBySession.get(sessionId);
          if (!leases) return;
          for (const lease of leases) {
            yield* doDisconnect(lease.projectPath, lease.serverName, false);
          }
          leasesBySession.delete(sessionId);
        }),

      disposeProject: (projectPath: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const projectClients = clientsByProject.get(projectPath);
          if (!projectClients) return;
          for (const [name] of projectClients) {
            for (const [sessionId, leases] of leasesBySession) {
              for (const lease of leases) {
                if (lease.projectPath === projectPath) {
                  leases.delete(lease);
                }
              }
              if (leases.size === 0) leasesBySession.delete(sessionId);
            }
            yield* doDisconnect(projectPath, name, true);
          }
          clientsByProject.delete(projectPath);
        }),
    };
  }
));

function namespacedName(serverName: string, toolName: string): string {
  return `${serverName}:${toolName}`;
}

function mcpToolToSpec(
  serverName: string,
  mcpTool: McpRawTool,
  client: McpClient,
  isDisabledFn: () => boolean
): McpToolSpec {
  return {
    server: serverName,
    name: mcpTool.name,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    readOnlyHint: mcpTool.readOnlyHint,
    execute: (args) => {
      if (isDisabledFn())
        return Effect.fail(
          new AgentError('TOOL_EXECUTION_FAILED', `MCP server '${serverName}' is disabled`)
        );
      return Effect.gen(function* () {
        const result = yield* client
          .callTool(mcpTool.name, args as Record<string, unknown>)
          .pipe(
            Effect.catchAll((err) =>
              Effect.fail(
                new AgentError(
                  'TOOL_EXECUTION_FAILED',
                  `MCP tool '${mcpTool.name}' failed: ${String(err)}`,
                  err
                )
              )
            )
          );
        return result;
      });
    },
  };
}
