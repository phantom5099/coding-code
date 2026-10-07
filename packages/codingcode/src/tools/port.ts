import { Context } from 'effect';
import type { Effect } from 'effect';
import type { McpToolSpec } from '../mcp/types.js';
import type { ToolCatalog } from './types.js';

export interface ToolExecutorShape {
  /** 按工具名 + 调用方提供的 MCP 工具装配出本轮可用的工具集 */
  prepare(toolNames: readonly string[], mcpTools?: McpToolSpec[]): Effect.Effect<ToolCatalog>;
}

export class ToolExecutorService extends Context.Tag('ToolExecutor')<
  ToolExecutorService,
  ToolExecutorShape
>() {}
