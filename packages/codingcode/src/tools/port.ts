import { Context } from 'effect';
import type { Effect } from 'effect';
import type { ToolCall } from '../core/types.js';
import type { ToolDefinition } from './types.js';

export type ToolResultUnion =
  | { type: 'ok'; id: string; name: string; output: string }
  | { type: 'denied'; id: string; name: string; reason: string }
  | { type: 'error'; id: string; name: string; output: string };

export type ToolLookup = (name: string) => ToolDefinition<any> | undefined;

export interface ToolExecutorShape {
  executeBatch(toolCalls: ToolCall[], sessionId?: string, opts?: {
    turnId?: number;
    projectPath?: string;
    signal?: AbortSignal;
    approval?: import('../approval/port.js').ApprovalService;
    toolLookup?: ToolLookup;
    permissionMode?: import('../approval/types.js').PermissionMode;
  }): Effect.Effect<ToolResultUnion[], never, any>;
}

export class ToolExecutorService extends Context.Tag('ToolExecutor')<ToolExecutorService, ToolExecutorShape>() {}
