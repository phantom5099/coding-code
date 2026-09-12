import type { Message, ToolCall, ToolDescription, TokenUsage } from '../core/types.js';

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
