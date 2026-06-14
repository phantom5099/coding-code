import { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { LLMRequest, LLMResponse, ModelInfo } from './types.js';

export interface StreamResult {
  stream: AsyncIterable<string>;
  response: Promise<{ ok: true; value: LLMResponse } | { ok: false; error: AgentError }>;
}

export interface LLMClient {
  complete(req: LLMRequest, signal?: AbortSignal): Effect.Effect<LLMResponse, AgentError>;
  completeStream(req: LLMRequest, signal?: AbortSignal): StreamResult;
  readonly modelInfo: ModelInfo;
}
