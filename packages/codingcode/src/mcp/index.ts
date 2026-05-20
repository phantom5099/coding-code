import { Effect } from 'effect';
import { z } from 'zod';
import { loadMcpConfig } from './config';
import { McpClient, McpError } from './client';
import type { McpStatus } from './types';
import type { ToolDefinition } from '../tools/types';
import { ToolService } from '../tools/registry';

export { McpError, McpClient };
export type { McpStatus };

export class McpService extends Effect.Service<McpService>()('Mcp', {
  effect: Effect.gen(function* () {
    const tools = yield* ToolService;
    const clients = new Map<string, McpClient>();

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
              yield* tools.register(mcpToolToDefinition(cfg.name, mt, result.client));
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

      status: (): Effect.Effect<McpStatus[]> =>
        Effect.sync(() =>
          Array.from(clients.entries()).map(([name, client]) => ({
            name,
            connected: client.connected,
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
): ToolDefinition {
  return {
    name: mcpTool.name,
    description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
    parameters: z.object({}).passthrough(),
    jsonSchema: mcpTool.inputSchema,
    execute: async (args: unknown) => {
      const result = await Effect.runPromise(
        client.callTool(mcpTool.name, args as Record<string, unknown>),
      );
      return result;
    },
  };
}
