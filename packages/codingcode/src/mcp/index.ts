import { Effect } from 'effect';
import { z } from 'zod';
import { resolveMcpConfig, resolveMcpDisabled } from './config.js';
import { McpClient, McpError } from './client.js';
import type { McpServerConfig, McpStatus } from './types.js';
import type { ToolDefinition, ToolExecCtx } from '../tools/types.js';
import { createLogger } from '@codingcode/infra/logger';
import { AgentError } from '../core/error.js';

const logger = createLogger();

interface McpRawTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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

export class McpService extends Effect.Service<McpService>()('Mcp', {
  effect: Effect.gen(function* () {
    const clientsByProject = new Map<ProjectPath, Map<ServerName, ServerEntry>>();
    const leasesBySession = new Map<string, Set<LeaseEntry>>();
    const disabledMcpByProject = new Map<ProjectPath, Set<ServerName>>();
    const configCache = new Map<ProjectPath, McpServerConfig[]>();

    function getConfig(projectPath: string): McpServerConfig[] {
      const cached = configCache.get(projectPath);
      if (cached) return cached;
      const configs = resolveMcpConfig(projectPath);
      configCache.set(projectPath, configs);
      return configs;
    }

    function getProjectClients(projectPath: string): Map<ServerName, ServerEntry> {
      let map = clientsByProject.get(projectPath);
      if (!map) {
        map = new Map();
        clientsByProject.set(projectPath, map);
      }
      return map;
    }

    function isDisabled(projectPath: string, serverName: string): boolean {
      return resolveMcpDisabled(projectPath, serverName);
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
          configCache.set(projectPath, configs);
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
            yield* doConnect(cfg, projectPath, false);
          }
        }),

      connectServers: (
        projectPath: string,
        sessionId: string,
        names: string[]
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const configs = getConfig(projectPath);
          const configMap = new Map(configs.map((c) => [c.name, c]));

          for (const name of names) {
            const cfg = configMap.get(name);
            if (!cfg) {
              logger.warn(
                `[MCP] Server '${name}' not found in mcp.yaml for project '${projectPath}', skipping`
              );
              continue;
            }
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

      listProjectMcpTools: (projectPath: string): ToolDefinition[] => {
        const projectClients = clientsByProject.get(projectPath);
        if (!projectClients) return [];
        const tools: ToolDefinition[] = [];
        for (const [serverName, entry] of projectClients) {
          for (const raw of entry.rawTools) {
            tools.push(
              mcpToolToDefinition(serverName, raw, entry.client, () =>
                isDisabled(projectPath, serverName)
              )
            );
          }
        }
        return tools;
      },

      status: (projectPath: string): Effect.Effect<McpStatus[]> =>
        Effect.sync(() => {
          const projectClients = clientsByProject.get(projectPath);
          if (!projectClients) return [];
          return Array.from(projectClients.entries()).map(([name, entry]) => ({
            name,
            connected: entry.client.connected,
            disabled: isDisabled(projectPath, name),
            toolCount: entry.rawTools.length,
            transport: entry.client.transportType,
            reconnectAttempts: 0,
            leaseCount: countLeases(projectPath, name),
          }));
        }),

      disable: (projectPath: string, name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          let set = disabledMcpByProject.get(projectPath);
          if (!set) {
            set = new Set();
            disabledMcpByProject.set(projectPath, set);
          }
          set.add(name);
        }),

      enable: (projectPath: string, name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          disabledMcpByProject.get(projectPath)?.delete(name);
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
          disabledMcpByProject.delete(projectPath);
          configCache.delete(projectPath);
        }),
    };
  }),
}) {}

function namespacedName(serverName: string, toolName: string): string {
  return `${serverName}:${toolName}`;
}

function mcpToolToDefinition(
  serverName: string,
  mcpTool: { name: string; description: string; inputSchema: Record<string, unknown> },
  client: McpClient,
  isDisabledFn: () => boolean
): ToolDefinition {
  return {
    name: `${serverName}:${mcpTool.name}`,
    description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
    parameters: z.object({}).passthrough(),
    jsonSchema: mcpTool.inputSchema,
    execute: (args: unknown, _ctx?: ToolExecCtx) => {
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
