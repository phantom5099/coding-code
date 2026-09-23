import type { Effect } from 'effect';
import type { Message, ToolCall, ToolDescription, TokenUsage } from './types.js';
import type { AgentError } from '../core/error.js';

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
      readonly args: Record<string, unknown>;
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
  /** 产出 SDK 流部件；失败时在迭代中抛出 AgentError */
  completeStream(req: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMStreamPart>;
  readonly modelInfo: ModelInfo;
}

export interface SelectableModel {
  id: string;
  provider: string;
  driver: string;
  name: string;
  model: string;
  base_url: string;
  api_key_env: string;
  context_window: number;
}
