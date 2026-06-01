import { Effect } from 'effect';
import type { Message } from '../core/types.js';
import { getContextConfig, type ContextConfig } from './config.js';
import { compactWithLLM, compactIfNeeded, type CompressResult } from './compressor/index.js';
import { assemblePayload } from './organizer.js';
import type { LLMClient } from '../llm/client.js';

export class ContextService extends Effect.Service<ContextService>()('Context', {
  effect: Effect.gen(function* () {
    return {
      /**
       * Build the message array to send to the LLM next. Uses the event
       * pipeline (raw JSONL → summary/hide filter).
       *
       * The optional `pendingUser` lets the caller append the about-to-be-sent
       * user message; if omitted, only the persisted history is returned.
       */
      build: (sessionId: string, encodedProjectPath: string, pendingUser?: Message, pinned: Message[] = [], config?: ContextConfig): Effect.Effect<Message[]> =>
        Effect.sync(() => {
          const cfg = config ?? getContextConfig();
          return assemblePayload(sessionId, encodedProjectPath, pendingUser ?? null, pinned, cfg);
        }),

      compress: (sessionId: string, encodedProjectPath: string, llm: LLMClient | null = null, usage?: number, config?: ContextConfig): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const cfg = config ?? getContextConfig();
          return await compactWithLLM(sessionId, encodedProjectPath, cfg, llm, usage);
        }),
      compactIfNeeded: (sessionId: string, encodedProjectPath: string, llm: LLMClient | null, promptEstimate: number, config?: ContextConfig): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const cfg = config ?? getContextConfig();
          return await compactIfNeeded(sessionId, encodedProjectPath, promptEstimate, cfg, llm);
        }),
    };
  }),
}) {}

