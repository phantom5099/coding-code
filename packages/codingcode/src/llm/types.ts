import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
  name?: string;
  usage?: TokenUsage;
}

/** 请求里"给模型看的"工具描述。 */
export interface ToolDescription {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequest {
  messages: Message[];
  system?: string;
  tools?: ToolDescription[];
  maxSteps?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}

/** 一次 LLM 调用的流式部件：内容与终结边界 */
export type LLMStreamPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_call';
      readonly id: string;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly type: 'end'; readonly usage?: TokenUsage };

export interface ModelInfo {
  provider: string;
  model: string;
  maxTokens: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
}

export interface LLMClient {
  complete(req: LLMRequest, signal?: AbortSignal): Effect.Effect<LLMResponse, AgentError>;
  completeStream(req: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMStreamPart>;
  readonly modelInfo: ModelInfo;
}
