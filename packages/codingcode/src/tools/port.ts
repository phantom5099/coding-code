import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ToolCall } from '../contracts/types.js';
import type { ToolLookup, ToolResult } from '../contracts/tool.js';

export interface ToolExecutorShape {
  executeBatch(toolCalls: ToolCall[], sessionId?: string, opts?: {
    turnId?: number;
    projectPath?: string;
    signal?: AbortSignal;
    toolLookup?: ToolLookup;
  }): Effect.Effect<ToolResult[], never, any>;
}

export class ToolExecutorService extends Context.Tag('ToolExecutor')<ToolExecutorService, ToolExecutorShape>() {}
