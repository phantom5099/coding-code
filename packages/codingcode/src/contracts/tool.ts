import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { ToolOutcome } from './frame.js';

export interface ToolExecCtx {
  signal?: AbortSignal;
  sessionId?: string;
  projectPath?: string;
}

export type ToolResult = { readonly id: string; readonly name: string } & ToolOutcome;

export interface ToolRunner {
  readonly name: string;
  parse(args: unknown): unknown;
  execute(args: unknown, ctx?: ToolExecCtx): Effect.Effect<string, AgentError, any>;
}

export type ToolLookup = (name: string) => ToolRunner | undefined;
