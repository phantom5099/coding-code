import { Effect, Layer } from 'effect';
import { resolveMcpConfig } from './config.js';
import { McpClient } from './client.js';
import { McpService } from './port.js';
import type { McpServerConfig, McpStatus, McpToolSpec } from '../contracts/mcp.js';
import { createLogger } from '@codingcode/infra/logger';
import { AgentError } from '../core/error.js';

const logger = createLogger();

/** 客户端 listTools() 的原始返回形状（SDK 类型在 client.ts 内部收口） */
interface McpRawTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint: boolean;
}

interface ServerEntry {
  client: McpClient;
  rawTools: McpRawTool[];
}

type ProjectPath = string;
type ServerName = string;

export const McpLayer = Layer.effect(McpService, Effect.sync(() => {
    const clientsByProject = new Map<ProjectPath, Map<ServerName, ServerEntry>>();

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

    function doConnect(cfg: McpServerConfig, projectPath: string): Effect.Effect<void> {
      return Effect.gen(function* () {
        const projectClients = getProjectClients(projectPath);
        if (projectClients.has(cfg.name)) return;

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

        if (!result) return;

        const rawTools: McpRawTool[] = result.mcpTools.map((mt: any) => ({
          name: mt.name,
          description: mt.description ?? '',
          inputSchema: mt.inputSchema ?? {},
          readOnlyHint: mt.readOnlyHint ?? false,
        }));

        projectClients.set(cfg.name, { client: result.client, rawTools });
      });
    }

    function doDisconnect(projectPath: string, name: string): Effect.Effect<void> {
      return Effect.gen(function* () {
        const projectClients = clientsByProject.get(projectPath);
        if (!projectClients) return;
        const entry = projectClients.get(name);
        if (!entry) return;

        yield* Effect.tryPromise(() => entry.client.disconnect()).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        );

        projectClients.delete(name);
        if (projectClients.size === 0) {
          clientsByProject.delete(projectPath);
        }
      });
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
                yield* doDisconnect(projectPath, name);
              }
            }
          }

          for (const cfg of configs) {
            if (cfg.enabled === false) {
              yield* doDisconnect(projectPath, cfg.name);
              continue;
            }
            yield* doConnect(cfg, projectPath);
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
            toolCount: entry.rawTools.length,
            transport: entry.client.transportType,
          }));
        }),
    };
  }
));

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
