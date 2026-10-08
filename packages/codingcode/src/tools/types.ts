import { z } from 'zod';
import { Effect } from 'effect';
import type { AgentError } from '../util/error.js';
import type { ToolCall, ToolDescription } from '../llm/types.js';
import type { ProfileName } from '../session/types.js';
import type { ToolOutcome } from '../sink/types.js';

export interface ToolDefinition<R = never> {
  name: string;
  /** 是否可与同批其它工具并发；省略即 false（fail-closed） */
  concurrencySafe?: boolean;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: unknown, ctx?: ToolExecCtx) => Effect.Effect<string, AgentError, R>;
}


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


export type ToolExecOpts = Omit<ToolExecCtx, 'sessionId'> & { turnId?: number };

export type ToolExecCall = ToolExecOpts & { sessionId?: string; callId?: string };

export interface ToolCatalog {
  tools: ToolDescription[];
  executeBatch(
    toolCalls: ToolCall[],
    sessionId: string | undefined,
    opts: ToolExecOpts
  ): Effect.Effect<ToolResult[]>;
}
