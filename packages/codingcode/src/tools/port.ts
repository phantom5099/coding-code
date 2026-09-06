import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { ToolCall } from '../core/types.js';
import type { ToolDefinition } from './types.js';

export type ToolResultUnion =
  | { type: 'ok'; id: string; name: string; output: string }
  | { type: 'denied'; id: string; name: string; reason: string }
  | { type: 'error'; id: string; name: string; output: string };

export type ToolLookup = (name: string) => ToolDefinition | undefined;

export interface ToolExecutorShape {
  execute(name: string, args: unknown, opts?: {
    signal?: AbortSignal;
    sessionId?: string;
    turnId?: number;
    projectPath?: string;
    approval?: import('../approval/port.js').ApprovalService;
    callId?: string;
    toolLookup?: ToolLookup;
  }): Effect.Effect<{ output: string; diff?: string; filePath?: string; insertions?: number; deletions?: number }, AgentError, any>;
  executeBatch(toolCalls: ToolCall[], sessionId?: string, opts?: {
    turnId?: number;
    projectPath?: string;
    signal?: AbortSignal;
    approval?: import('../approval/port.js').ApprovalService;
    toolLookup?: ToolLookup;
  }): Effect.Effect<ToolResultUnion[], never, any>;
}

export class ToolExecutorService extends Context.Tag('ToolExecutor')<ToolExecutorService, ToolExecutorShape>() {}
