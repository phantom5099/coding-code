import type { ToolCall } from '../core/types.js';
import type { AgentError } from '../core/error.js';
import type { SessionStoreState } from '../session/types.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolDefinition, ToolVisibilityPolicy } from '../tools/types.js';
import type { AgentProfile } from '../subagent/types.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface Todo {
  step: string;
  status: TodoStatus;
}

export interface TodoCounts {
  pending: number;
  in_progress: number;
  completed: number;
}

export type SystemPromptVariant = 'default';

export interface SystemPromptOptions {
  cwd: string;
  platform: string;
  shell: string;
  variant?: SystemPromptVariant;
  skillInstruction?: string;
  agentProfiles?: AgentProfile[];
  rules?: string;
}

export interface ResolvedConfig {
  maxSteps: number;
  maxStopContinuations: number;
}

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
      readonly _tag: 'ApprovalRequest';
      readonly id: string;
      readonly tool: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly _tag: 'ToolResult';
      readonly id: string;
      readonly name: string;
      readonly output: string;
      readonly ok: boolean;
    }
  | { readonly _tag: 'Step'; readonly step: number; readonly max: number }
  | {
      readonly _tag: 'ReactiveCompact';
      readonly attempt: number;
      readonly released: number;
      readonly promptEstimate: number;
    }
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
      readonly _tag: 'Usage';
      readonly prompt: number;
      readonly completion: number;
      readonly total: number;
    };

export interface RunStreamOptions {
  state: SessionStoreState;
  llm: LLMClient;
  skillInstruction?: string;
  systemPromptVariant?: SystemPromptVariant;
  systemOverride?: string;
  coreAllowlist?: ReadonlySet<string>;
  toolPolicy?: ToolVisibilityPolicy;
  dispatchTool?: ToolDefinition;
  mcpTools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  parentSessionId?: string;
  agentName?: string;
  maxStepsOverride?: number;
  maxStopContinuations?: number;
  approvalOverride?: any;
  rulesText?: string;
}
