import { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { LLMRequest, LLMResponse, LLMStreamPart, ModelInfo } from './types.js';

export interface LLMClient {
  complete(req: LLMRequest, signal?: AbortSignal): Effect.Effect<LLMResponse, AgentError>;
  /** 产出 SDK 流部件；失败时在迭代中抛出 AgentError */
  completeStream(req: LLMRequest, signal?: AbortSignal): AsyncIterable<LLMStreamPart>;
  readonly modelInfo: ModelInfo;
}
