import { z } from 'zod';
import { Effect } from 'effect';
import type { ToolDefinition, ToolExecCtx, ToolCatalog } from './types.js';
import type { McpToolSpec } from '@codingcode/mcp';
import { AgentError } from '@codingcode/util';
import { ToolRegistry } from './registry.js';

function specToDefinition(spec: McpToolSpec): ToolDefinition {
  return {
    name: `${spec.server}:${spec.name}`,
    description: `[MCP:${spec.server}] ${spec.description || spec.name}`,
    parameters: z.fromJSONSchema(spec.inputSchema),
    concurrencySafe: spec.readOnlyHint,
    approval: { action: 'mcp', requiresConfirmation: true },
    execute: (args, ctx) => {
      if (!ctx?.sandboxPolicy) {
        return Effect.fail(
          new AgentError('SANDBOX_POLICY_DENIED', 'MCP tool requires a sandbox policy')
        );
      }
      if (
        ctx.sandboxPolicy.mode !== 'danger-full-access' &&
        ctx.sandboxPolicy.mode !== 'unrestricted' &&
        !spec.readOnlyHint
      ) {
        return Effect.fail(
          new AgentError(
            'SANDBOX_POLICY_DENIED',
            'MCP tool is not read-only under the current sandbox'
          )
        );
      }
      return spec.execute(args as Record<string, unknown>);
    },
  };
}

export function createToolCatalog(
  definitions: readonly ToolDefinition<any, any>[] = [],
  mcpTools: McpToolSpec[] = []
): ToolCatalog {
  const registry = new ToolRegistry();
  registry.register(...definitions);
  registry.register(...mcpTools.map(specToDefinition));
  return {
    tools: registry.describe(),
    lookup: (name) => {
      const definition = registry.get(name);
      if (!definition) return undefined;
      return {
        name: definition.name,
        concurrencySafe: definition.concurrencySafe ?? false,
        approval: definition.approval ?? { action: 'other' },
        describeOperation:
          definition.describeOperation ?? (() => definition.approval ?? { action: 'other' }),
        parse: (args: unknown) => (definition.parameters.parse(args) ?? {}) as Record<string, unknown>,
        execute: (args: unknown, ctx?: ToolExecCtx) =>
          definition.execute(args, ctx) as Effect.Effect<string, AgentError>,
      };
    },
  };
}
