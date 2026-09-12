import { Context } from 'effect';
import type { Message } from '../core/types.js';
import type { LLMClient } from '../llm/client.js';

export interface CompressResult {
  didCompress: boolean;
  released: number;
  promptEstimate: number;
}

export interface ContextShape {
  willCompact(transcriptPath: string, contextWindow: number): Promise<boolean>;
  assemblePayload(transcriptPath: string, contextWindow: number, llm: LLMClient | null): Promise<Message[]>;
  compactWithLLM(transcriptPath: string, modelMaxTokens: number, llm: LLMClient | null, usage?: number): Promise<CompressResult>;
}

export class ContextService extends Context.Tag('Context')<ContextService, ContextShape>() {}
