import type { ToolDefinition } from './types.js';
import type { ToolDescription } from '../core/types.js';
import type { ToolLookup } from './port.js';
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

// 全量静态工具表：名字 -> 工具定义。agent 只传名字名单，这里按名查表装配，
// 不感知 profile / allowedTools 的取舍（取舍由 agent 侧的名单本身决定）。
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

export function createToolCatalog(
  toolNames: readonly string[],
  mcpTools: ToolDefinition<any>[] = []
): { tools: ToolDescription[]; lookup: ToolLookup } {
  const registry = new ToolRegistry();
  for (const name of toolNames) {
    const definition = TOOLS_BY_NAME.get(name);
    if (!definition) throw new Error(`Unknown tool: ${name}`);
    registry.register(definition);
  }
  registry.register(...mcpTools);
  return {
    tools: registry.describe(),
    lookup: (name) => registry.get(name),
  };
}

export { TOOLS_BY_NAME };
