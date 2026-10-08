import { z } from 'zod';
import type { Effect } from 'effect';
import type { ToolDefinition, ToolExecCtx, ToolRunner } from './types.js';
import type { ToolDescription } from '../llm/types.js';
import type { McpToolSpec } from '../mcp/types.js';
import type { AgentError } from '../util/error.js';
import { ToolRegistry } from './registry.js';
import { readFileTool } from './domains/fs/read.js';
import { writeFileTool } from './domains/fs/write.js';
import { editFileTool } from './domains/fs/edit.js';
import { bashTool } from './domains/bash/exec.js';
import { searchTool } from './domains/fs/grep.js';
import { globTool } from './domains/fs/glob.js';
import { webFetchTool } from './domains/web/fetch.js';
import { webSearchTool } from './domains/web/search.js';
import { todoWriteTool } from './domains/self/todo-write.js';
import { spawnAgentTool } from './domains/subagent/spawn.js';
import { waitAgentTool } from './domains/subagent/wait.js';
import { submitPlanTool } from './domains/subagent/submit-plan.js';

const ALL_TOOLS: ToolDefinition<any>[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  searchTool,
  globTool,
  webFetchTool,
  webSearchTool,
  todoWriteTool,
  spawnAgentTool,
  waitAgentTool,
  submitPlanTool,
];

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

function specToDefinition(spec: McpToolSpec): ToolDefinition {
  return {
    name: `${spec.server}:${spec.name}`,
    description: `[MCP:${spec.server}] ${spec.description || spec.name}`,
    parameters: z.fromJSONSchema(spec.inputSchema),
    concurrencySafe: spec.readOnlyHint,
    execute: (args) => spec.execute(args as Record<string, unknown>),
  };
}

/** 装配产物：给模型看的描述 + 内部查找（不对外暴露）。 */
export interface ToolCatalogSource {
  readonly tools: ToolDescription[];
  readonly lookup: (name: string) => ToolRunner | undefined;
}

export function createToolCatalog(
  toolNames: readonly string[],
  mcpTools: McpToolSpec[] = []
): ToolCatalogSource {
  const registry = new ToolRegistry();
  for (const name of toolNames) {
    const definition = TOOLS_BY_NAME.get(name);
    if (!definition) throw new Error(`Unknown tool: ${name}`);
    registry.register(definition);
  }
  registry.register(...mcpTools.map(specToDefinition));
  return {
    tools: registry.describe(),
    lookup: (name) => {
      const definition = registry.get(name);
      if (!definition) return undefined;
      return {
        name: definition.name,
        concurrencySafe: definition.concurrencySafe ?? false,
        parse: (args: unknown) => definition.parameters.parse(args),
        execute: (args: unknown, ctx?: ToolExecCtx) =>
          definition.execute(args, ctx) as Effect.Effect<string, AgentError>,
      };
    },
  };
}

export { TOOLS_BY_NAME };
