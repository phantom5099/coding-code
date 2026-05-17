import type { ToolDescription } from '../tools/types.js';

export interface AgentConfig {
  role: string;
  model?: string;
  maxSteps?: number;
  systemPrompt?: string;
  availableTools?: string[];
}

export interface LoopState {
  step: number;
  maxSteps: number;
  lastToolCalls?: import('../core/types.js').ToolCall[];
}

// Agent 纯流式事件的联合类型——Agent 不感知 Context、Bus、Session
export type ReActEvent =
  | { type: 'text'; text: string }
  | { type: 'assistant'; content: string; toolCalls?: import('../core/types.js').ToolCall[] }
  | { type: 'toolStart'; name: string; arguments: Record<string, unknown> }
  | { type: 'toolResult'; id: string; name: string; output: string; ok: boolean }
  | { type: 'step'; step: number; max: number }
  | { type: 'error'; error: import('../core/error.js').AgentError };
