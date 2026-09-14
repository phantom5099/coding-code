import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { ToolDescription } from '../contracts/types.js';
import type { ToolLookup } from '../contracts/tool.js';
import type { McpToolSpec } from '../contracts/mcp.js';
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
import { dispatchAgentTool } from './domains/subagent/dispatch.js';
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
  dispatchAgentTool,
  submitPlanTool,
];

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

function specToDefinition(spec: McpToolSpec): ToolDefinition {
  return {
    name: `${spec.server}:${spec.name}`,
    description: `[MCP:${spec.server}] ${spec.description || spec.name}`,
    parameters: z.fromJSONSchema(spec.inputSchema),
    execute: (args) => spec.execute(args as Record<string, unknown>),
  };
}

export function createToolCatalog(
  toolNames: readonly string[],
  mcpTools: McpToolSpec[] = []
): { tools: ToolDescription[]; lookup: ToolLookup } {
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
      return definition
        ? {
            name: definition.name,
            parse: (args: unknown) => definition.parameters.parse(args),
            execute: definition.execute,
          }
        : undefined;
    },
  };
}

export { TOOLS_BY_NAME };
