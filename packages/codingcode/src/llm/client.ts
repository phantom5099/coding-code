import type { Result } from '../core/result.js';
import type { AgentError } from '../core/error.js';
import type { LLMRequest, LLMResponse, ModelInfo } from './types.js';

export interface StreamResult {
  stream: AsyncIterable<string>;
  response: Promise<Result<LLMResponse, AgentError>>;
}

export interface LLMClient {
  complete(req: LLMRequest, signal?: AbortSignal): Promise<Result<LLMResponse, AgentError>>;
  completeStream(req: LLMRequest, signal?: AbortSignal): StreamResult;
  readonly modelInfo: ModelInfo;
}
