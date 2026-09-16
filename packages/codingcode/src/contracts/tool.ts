import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { ToolOutcome } from './frame.js';
import type { ToolDescription } from './types.js';

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

// 一次装配出的工具集：tools 为纯描述喂模型，lookup 供执行器解析
export interface ToolCatalog {
  tools: ToolDescription[];
  lookup: ToolLookup;
}
