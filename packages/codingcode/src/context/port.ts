import { Context } from 'effect';
import type { Effect } from 'effect';
import type { Message } from '../contracts/types.js';
import type { AgentError } from '../core/error.js';

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}

export interface ContextShape {
  willCompact(transcriptPath: string, model: string): Effect.Effect<boolean, AgentError>;
  assemblePayload(transcriptPath: string, model: string): Effect.Effect<Message[], AgentError>;
  compactWithLLM(transcriptPath: string, model: string, usage?: number): Effect.Effect<CompressResult, AgentError>;
}

export class ContextService extends Context.Tag('Context')<ContextService, ContextShape>() {}
