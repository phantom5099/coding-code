import { Effect } from 'effect';
import { z } from 'zod';
import { loadMcpConfig } from './config.js';
import { McpClient, McpError } from './client.js';
import type { McpServerConfig, McpStatus } from './types.js';
import type { ToolDefinition, ToolExecCtx } from '../tools/types.js';
import { ToolService } from '../tools/registry.js';
import { createLogger } from '@codingcode/infra';

const logger = createLogger();

export { McpError, McpClient };
export type { McpStatus };

interface ServerEntry {
  client: McpClient;
  config: McpServerConfig;
  toolNames: string[];
  refCount: number;
}

export class McpService extends Effect.Service<McpService>()('Mcp', {
  effect: Effect.gen(function* () {
    const tools = yield* ToolService;
    const clients = new Map<string, ServerEntry>();
    const _disabled = new Set<string>();

    function namespacedName(serverName: string, toolName: string): string {
      return `${serverName}:${toolName}`;
    }

    function doConnect(cfg: McpServerConfig, bumpRef: boolean): Effect.Effect<string[]> {
      return Effect.gen(function* () {
        const existing = clients.get(cfg.name);
        if (existing) {
          if (bumpRef) existing.refCount++;
          return existing.toolNames;
        }

        const result = yield* Effect.tryPromise(async () => {
          const client = new McpClient(cfg);
          await client.connect();
          const mcpTools = await client.listTools();
          return { client, mcpTools };
        }).pipe(
          Effect.catchAll((err) => {
            logger.error(`[MCP] Failed to connect to '${cfg.name}': ${String(err)}`);
            return Effect.succeed(undefined);
          })
        );

        if (!result) return [];

        const registeredNames: string[] = [];
        for (const mt of result.mcpTools) {
          const nsName = namespacedName(cfg.name, mt.name);
          yield* tools.register(mcpToolToDefinition(cfg.name, mt, result.client, _disabled));
          registeredNames.push(nsName);
        }

        clients.set(cfg.name, {
          client: result.client,
          config: cfg,
          toolNames: registeredNames,
          refCount: bumpRef ? 1 : 0,
        });

        return registeredNames;
      });
    }

    function doDisconnect(name: string, force: boolean): Effect.Effect<void> {
      return Effect.gen(function* () {
        const entry = clients.get(name);
        if (!entry) return;

        if (!force) {
          entry.refCount--;
          if (entry.refCount > 0) return;
        }

        for (const toolName of entry.toolNames) {
          yield* tools.unregister(toolName);
        }

        yield* Effect.tryPromise(() => entry.client.disconnect()).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        );

        clients.delete(name);
      });
    }

    return {
      syncConnections: (projectRoot: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const configs = loadMcpConfig(projectRoot);
          const configNames = new Set(configs.map((c) => c.name));

          // Force disconnect removed servers
          for (const [name, entry] of clients) {
            if (!configNames.has(name)) {
              yield* doDisconnect(name, true);
            }
          }

          // Connect new servers (no refCount bump for existing)
          for (const cfg of configs) {
            yield* doConnect(cfg, false);
          }
        }),

      connectServers: (names: string[], projectRoot: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const configs = loadMcpConfig(projectRoot);
          const configMap = new Map(configs.map((c) => [c.name, c]));

          for (const name of names) {
            const cfg = configMap.get(name);
            if (!cfg) {
              logger.warn(`[MCP] Server '${name}' not found in mcp.yaml, skipping`);
              continue;
            }
            yield* doConnect(cfg, true);
          }
        }),

      disconnectServers: (names: string[]): Effect.Effect<void> =>
        Effect.gen(function* () {
          for (const name of names) {
            yield* doDisconnect(name, false);
          }
        }),

      getServerToolNames: (name: string): string[] => {
        const entry = clients.get(name);
        return entry ? [...entry.toolNames] : [];
      },

      disconnectAll: (): Effect.Effect<void> =>
        Effect.gen(function* () {
          for (const [, entry] of clients) {
            yield* Effect.tryPromise(() => entry.client.disconnect()).pipe(
              Effect.catchAll(() => Effect.succeed(undefined))
            );
          }
          clients.clear();
        }),

      disable: (name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          _disabled.add(name);
        }),

      enable: (name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          _disabled.delete(name);
        }),

      status: (): Effect.Effect<McpStatus[]> =>
        Effect.sync(() =>
          Array.from(clients.entries()).map(([name, entry]) => ({
            name,
            connected: entry.client.connected,
            disabled: _disabled.has(name),
            toolCount: entry.client.tools.length,
            transport: entry.client.transportType,
            reconnectAttempts: 0,
          }))
        ),
    };
  }),
}) {}

function mcpToolToDefinition(
  serverName: string,
  mcpTool: { name: string; description: string; inputSchema: Record<string, unknown> },
  client: McpClient,
  disabled: Set<string>
): ToolDefinition {
  return {
    name: `${serverName}:${mcpTool.name}`,
    description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
    parameters: z.object({}).passthrough(),
    jsonSchema: mcpTool.inputSchema,
    execute: async (args: unknown, _ctx?: ToolExecCtx) => {
      if (disabled.has(serverName)) throw new Error(`MCP server '${serverName}' is disabled`);
      const result = await Effect.runPromise(
        client.callTool(mcpTool.name, args as Record<string, unknown>)
      );
      return result;
    },
  };
}
