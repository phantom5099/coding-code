import { Context } from 'effect';
import type { Effect } from 'effect';
import type { Message } from '../contracts/types.js';
import type { SessionRef } from '../contracts/session.js';
import type { AgentError } from '../core/error.js';

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}

export interface ContextShape {
  willCompact(ref: SessionRef, model: string): Effect.Effect<boolean, AgentError>;
  assemblePayload(ref: SessionRef, model: string): Effect.Effect<Message[], AgentError>;
  compactWithLLM(ref: SessionRef, model: string, usage?: number): Effect.Effect<CompressResult, AgentError>;
}

export class ContextService extends Context.Tag('Context')<ContextService, ContextShape>() {}
