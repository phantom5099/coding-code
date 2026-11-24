import { z } from 'zod';
import { Effect } from 'effect';
import type { ToolDefinition, ToolExecCtx, ToolCatalog } from './types.js';
import type { ToolApprovalMetadata } from './types.js';
import type { McpToolSpec } from '../mcp/types.js';
import { AgentError } from '../util/error.js';
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
import { todoReadTool } from './domains/self/todo-read.js';
import { askUserTool } from './domains/self/ask-user.js';
import { spawnAgentTool } from './domains/subagent/spawn.js';
import { waitAgentTool } from './domains/subagent/wait.js';
import { resumeAgentTool } from './domains/subagent/resume.js';
import { sendMessageTool } from './domains/subagent/message.js';
import { interruptAgentTool } from './domains/subagent/interrupt.js';
import { listAgentsTool } from './domains/subagent/list.js';

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
  todoReadTool,
  askUserTool,
  spawnAgentTool,
  waitAgentTool,
  resumeAgentTool,
  sendMessageTool,
  interruptAgentTool,
  listAgentsTool,
];

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

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

export function createToolCatalog(mcpTools: McpToolSpec[] = []): ToolCatalog {
  const registry = new ToolRegistry();
  registry.register(...TOOLS_BY_NAME.values());
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
        describeOperation: definition.describeOperation ?? (() => definition.approval ?? { action: 'other' }),
        parse: (args: unknown) => definition.parameters.parse(args),
        execute: (args: unknown, ctx?: ToolExecCtx) =>
          definition.execute(args, ctx) as Effect.Effect<string, AgentError>,
      };
    },
  };
}

export { TOOLS_BY_NAME };
