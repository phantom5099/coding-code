import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../util/error.js';
import type { McpToolSpec } from '../mcp/types.js';
import type { ToolCall } from '../llm/types.js';
import type {
  ParsedToolCall,
  PreparedToolBatch,
  PreparedToolCall,
  ToolCatalog,
  ToolExecOpts,
  ToolLookup,
  ToolResult,
} from './types.js';

export interface ToolExecutorShape {
  /** 装配完整的内置工具集，并合并调用方提供的 MCP 工具 */
  prepare(mcpTools?: McpToolSpec[]): Effect.Effect<ToolCatalog>;

  parseCall(toolCall: ToolCall, toolLookup: ToolLookup): Effect.Effect<ParsedToolCall, AgentError>;

  prepareBatch(
    toolCalls: readonly ToolCall[],
    sessionId: string | undefined,
    opts: ToolExecOpts,
    toolLookup: ToolLookup
  ): Effect.Effect<PreparedToolBatch>;

  executeBatch(
    toolCalls: readonly (PreparedToolCall | ToolCall)[],
    sessionId: string | undefined,
    opts: ToolExecOpts,
    toolLookup?: ToolLookup
  ): Effect.Effect<ToolResult[], AgentError>;
}

export class ToolExecutorService extends Context.Tag('ToolExecutor')<
  ToolExecutorService,
  ToolExecutorShape
>() {}
