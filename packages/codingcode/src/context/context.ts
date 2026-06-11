import { Effect } from 'effect';
import { getContextConfig, type ContextConfig } from './config.js';
import { compactWithLLM, compactIfNeeded, type CompressResult } from './compressor.js';
import { assemblePayload, type BuildResult } from './organizer.js';
import type { LLMClient } from '../llm/client.js';

export class ContextService extends Effect.Service<ContextService>()('Context', {
  effect: Effect.gen(function* () {
    return {
      /**
       * Build the message array to send to the LLM next. Uses the event
       * pipeline (raw JSONL → summary/hide filter).
       */
      build: (
        sessionId: string,
        encodedProjectPath: string,
        contextWindow?: number,
        config?: ContextConfig
      ): Effect.Effect<BuildResult> =>
        Effect.sync(() => {
          const cfg = config ?? getContextConfig();
          return assemblePayload(sessionId, encodedProjectPath, cfg, contextWindow);
        }),

      compress: (
        sessionId: string,
        encodedProjectPath: string,
        llm: LLMClient | null = null,
        usage?: number,
        modelMaxTokens?: number,
        config?: ContextConfig
      ): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const cfg = config ?? getContextConfig();
          return await compactWithLLM(
            sessionId,
            encodedProjectPath,
            cfg,
            llm,
            undefined,
            undefined,
            usage,
            modelMaxTokens
          );
        }),
      compactIfNeeded: (
        sessionId: string,
        encodedProjectPath: string,
        llm: LLMClient | null,
        messages: import('../core/types.js').Message[],
        modelMaxTokens: number,
        config?: ContextConfig,
        compactedEvents?: import('../session/types.js').SessionEvent[],
        currentTurnId?: number
      ): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const cfg = config ?? getContextConfig();
          return await compactIfNeeded(
            sessionId,
            encodedProjectPath,
            messages,
            modelMaxTokens,
            cfg,
            llm,
            compactedEvents,
            currentTurnId
          );
        }),
    };
  }),
}) {}
