import { Context } from 'effect';
import type { Effect } from 'effect';
import type { AgentError } from '@codingcode/util';
import type { LLMInvocation, LLMResponse, LLMStreamPart } from './types.js';

export interface LLMShape {
  complete(req: LLMInvocation): Effect.Effect<LLMResponse, AgentError>;
  completeStream(req: LLMInvocation): AsyncIterable<LLMStreamPart>;
}

export class LLMService extends Context.Tag('LLM')<LLMService, LLMShape>() {}
