import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../core/error.js';
import type { LLMRequest, LLMResponse, LLMStreamPart } from '../contracts/provider.js';

export interface LLMShape {
  complete(req: LLMRequest, model: string, signal?: AbortSignal): Effect.Effect<LLMResponse, AgentError>;
  completeStream(req: LLMRequest, model: string, signal?: AbortSignal): AsyncIterable<LLMStreamPart>;
}

export class LLMService extends Context.Tag('LLM')<LLMService, LLMShape>() {}
