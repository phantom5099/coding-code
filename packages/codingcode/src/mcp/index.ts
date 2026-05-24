import { Effect } from 'effect';
import { z } from 'zod';
import { loadMcpConfig } from './config';
import { McpClient, McpError } from './client';
import type { McpStatus } from './types';
import type { ToolDefinition, ToolExecCtx } from '../tools/types';
import { ToolService } from '../tools/registry';

export { McpError, McpClient };
export type { McpStatus };

export class McpService extends Effect.Service<McpService>()('Mcp', {
  effect: Effect.gen(function* () {
    const tools = yield* ToolService;
    const clients = new Map<string, McpClient>();
    const _disabled = new Set<string>();

    return {
      connectAll: (projectRoot: string): Effect.Effect<number> =>
        Effect.gen(function* () {
          const configs = loadMcpConfig(projectRoot);
          let count = 0;
          for (const cfg of configs) {
            const result = yield* Effect.tryPromise(async () => {
              const client = new McpClient(cfg);
              await client.connect();
              const mcpTools = await client.listTools();
              return { client, mcpTools };
            }).pipe(
              Effect.catchAll((err) => {
                console.error(`[MCP] Failed to connect to '${cfg.name}': ${String(err)}`);
                return Effect.succeed(undefined);
              }),
            );
            if (!result) continue;
            clients.set(cfg.name, result.client);
            for (const mt of result.mcpTools) {
              yield* tools.register(mcpToolToDefinition(cfg.name, mt, result.client, _disabled));
              count++;
            }
          }
          return count;
        }),

      disconnectAll: (): Effect.Effect<void> =>
        Effect.gen(function* () {
          for (const [, client] of clients) {
            yield* Effect.tryPromise(() => client.disconnect()).pipe(
              Effect.catchAll(() => Effect.succeed(undefined)),
            );
          }
          clients.clear();
        }),

      disable: (name: string): Effect.Effect<void> =>
        Effect.sync(() => { _disabled.add(name); }),

      enable: (name: string): Effect.Effect<void> =>
        Effect.sync(() => { _disabled.delete(name); }),

      status: (): Effect.Effect<McpStatus[]> =>
        Effect.sync(() =>
          Array.from(clients.entries()).map(([name, client]) => ({
            name,
            connected: client.connected,
            disabled: _disabled.has(name),
            toolCount: client.tools.length,
            transport: client.transportType,
            reconnectAttempts: 0,
          })),
        ),
    };
  }),
}) {}

function mcpToolToDefinition(
  serverName: string,
  mcpTool: { name: string; description: string; inputSchema: Record<string, unknown> },
  client: McpClient,
  disabled: Set<string>,
): ToolDefinition {
  return {
    name: mcpTool.name,
    description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
    parameters: z.object({}).passthrough(),
    jsonSchema: mcpTool.inputSchema,
    execute: async (args: unknown, _ctx?: ToolExecCtx) => {
      if (disabled.has(serverName)) throw new Error(`MCP server '${serverName}' is disabled`);
      const result = await Effect.runPromise(
        client.callTool(mcpTool.name, args as Record<string, unknown>),
      );
      return result;
    },
  };
}
