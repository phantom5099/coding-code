import { Effect, Layer } from 'effect';
import { McpService } from '../mcp/port.js';
import { ToolCatalogPort } from './deps.js';
import type { ToolCatalog } from './deps.js';
import { createToolCatalog } from '../tools/catalog.js';

export const ToolCatalogLayer: Layer.Layer<ToolCatalogPort, never, McpService> = Layer.effect(
  ToolCatalogPort,
  Effect.gen(function* () {
    const mcp = yield* McpService;
    return {
      register: (toolNames: readonly string[], cwd: string): Effect.Effect<ToolCatalog> =>
        Effect.gen(function* () {
          const mcpTools = yield* mcp.listProjectMcpTools(cwd);
          return createToolCatalog(toolNames, mcpTools);
        }),
    };
  })
);
