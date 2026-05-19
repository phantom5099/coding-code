import type { ToolCall } from '../core/types.js';
import type { AgentError } from '../core/error.js';

export type AgentEvent =
  | { readonly _tag: 'LlmChunk'; readonly text: string }
  | { readonly _tag: 'Assistant'; readonly content: string; readonly toolCalls?: ToolCall[] }
  | { readonly _tag: 'ToolStart'; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly _tag: 'ToolDenied'; readonly name: string; readonly reason: string }
  | { readonly _tag: 'ApprovalRequest'; readonly id: string; readonly tool: string; readonly args: Record<string, unknown> }
  | { readonly _tag: 'ToolResult'; readonly id: string; readonly name: string; readonly output: string; readonly ok: boolean }
  | { readonly _tag: 'Step'; readonly step: number; readonly max: number }
  | { readonly _tag: 'Error'; readonly error: AgentError }
  | { readonly _tag: 'Done'; readonly content: string };
