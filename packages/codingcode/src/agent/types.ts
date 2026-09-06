import type { ToolCall } from '../core/types.js';
import type { AgentError } from '../core/error.js';

export type AgentEvent =
  | { readonly _tag: 'LlmChunk'; readonly text: string }
  | { readonly _tag: 'Assistant'; readonly content: string; readonly toolCalls?: ToolCall[] }
  | {
      readonly _tag: 'ToolStart';
      readonly id: string;
      readonly name: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly _tag: 'ToolDenied';
      readonly id: string;
      readonly name: string;
      readonly reason: string;
    }
  | {
      readonly _tag: 'ToolResult';
      readonly id: string;
      readonly name: string;
      readonly output: string;
      readonly ok: boolean;
    }
  | { readonly _tag: 'Step'; readonly step: number; readonly max: number }
  | { readonly _tag: 'Error'; readonly error: AgentError }
  | { readonly _tag: 'Done'; readonly content: string }
  | {
      readonly _tag: 'TodoUpdate';
      readonly items: ReadonlyArray<{
        readonly step: string;
        readonly status: 'pending' | 'in_progress' | 'completed';
      }>;
    }
  | { readonly _tag: 'TurnId'; readonly turnId: number }
  | {
      readonly _tag: 'ContextCompressed';
      readonly released: number;
      readonly promptEstimate: number;
    }
  | {
      readonly _tag: 'Usage';
      readonly prompt: number;
      readonly completion: number;
      readonly total: number;
    };
