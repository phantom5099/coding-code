import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '@codingcode/util';
import type { McpToolSpec } from '@codingcode/mcp';
import type { ToolCall } from '@codingcode/model';
import type {
  ExecuteToolBatchRequest,
  ParsedToolCall,
  PrepareToolBatchRequest,
  PreparedToolBatch,
  ToolCatalog,
  ToolDefinition,
  ToolLookup,
  ToolResult,
} from './types.js';
import type { ToolDescription } from '@codingcode/model';

export interface ToolRegistryShape {
  register(...definitions: ToolDefinition<any, any>[]): void;
  get(name: string, allowedTools?: ReadonlySet<string>): ToolDefinition<any, any> | undefined;
  list(allowedTools?: ReadonlySet<string>): ToolDefinition<any, any>[];
  describe(allowedTools?: ReadonlySet<string>): ToolDescription[];
}

export class ToolRegistryService extends Context.Tag('ToolRegistry')<
  ToolRegistryService,
  ToolRegistryShape
>() {}

export interface ToolExecutorShape {
  /** 装配完整的内置工具集，并合并调用方提供的 MCP 工具 */
  prepare(mcpTools?: McpToolSpec[]): Effect.Effect<ToolCatalog>;

  parseCall(toolCall: ToolCall, toolLookup: ToolLookup): Effect.Effect<ParsedToolCall, AgentError>;

  prepareBatch(req: PrepareToolBatchRequest): Effect.Effect<PreparedToolBatch>;

  executeBatch(req: ExecuteToolBatchRequest): Effect.Effect<ToolResult[], AgentError>;
}

export class ToolExecutorService extends Context.Tag('ToolExecutor')<
  ToolExecutorService,
  ToolExecutorShape
>() {}
