import type { Message, ToolDescription } from '../core/types';

export interface LLMRequest {
  messages: Message[];
  system?: string;
  tools?: ToolDescription[];
  maxSteps?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: { prompt: number; completion: number; total: number };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface ModelInfo {
  provider: string;
  model: string;
  maxTokens: number;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
}
