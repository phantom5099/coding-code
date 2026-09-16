import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ToolCall } from '../contracts/types.js';
import type { McpToolSpec } from '../contracts/mcp.js';
import type { ToolCatalog, ToolLookup, ToolResult } from '../contracts/tool.js';

export interface ToolExecutorShape {
  // 按工具名 + 调用方提供的 MCP 工具装配出本轮可用的工具集
  prepare(toolNames: readonly string[], mcpTools?: McpToolSpec[]): Effect.Effect<ToolCatalog>;
  executeBatch(toolCalls: ToolCall[], sessionId?: string, opts?: {
    turnId?: number;
    projectPath?: string;
    signal?: AbortSignal;
    toolLookup?: ToolLookup;
  }): Effect.Effect<ToolResult[], never, any>;
}

export class ToolExecutorService extends Context.Tag('ToolExecutor')<ToolExecutorService, ToolExecutorShape>() {}
