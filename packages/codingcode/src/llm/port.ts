import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '../util/error.js';
import type { LLMRequest, LLMResponse, LLMStreamPart } from './types.js';

export interface LLMShape {
  complete(
    req: LLMRequest,
    model: string,
    signal?: AbortSignal
  ): Effect.Effect<LLMResponse, AgentError>;
  completeStream(
    req: LLMRequest,
    model: string,
    signal?: AbortSignal
  ): AsyncIterable<LLMStreamPart>;
}

export class LLMService extends Context.Tag('LLM')<LLMService, LLMShape>() {}
