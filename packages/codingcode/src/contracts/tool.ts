import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { ToolOutcome } from './frame.js';
import type { ToolDescription, ProfileName } from './types.js';

export interface ToolExecCtx {
  signal?: AbortSignal;
  sessionId?: string;
  projectPath?: string;
  activeProfile?: ProfileName;
  model: string;
}

export type ToolResult = { readonly id: string; readonly name: string } & ToolOutcome;

export interface ToolRunner {
  readonly name: string;
  readonly concurrencySafe: boolean;
  parse(args: unknown): unknown;
  execute(args: unknown, ctx?: ToolExecCtx): Effect.Effect<string, AgentError>;
}

export type ToolLookup = (name: string) => ToolRunner | undefined;

export interface ToolCatalog {
  tools: ToolDescription[];
  lookup: ToolLookup;
}
