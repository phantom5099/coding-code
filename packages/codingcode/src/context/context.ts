import { Effect } from 'effect';
import type { Message } from '../core/types.js';
import { getContextConfig, type ContextConfig } from './config.js';
import { run, runL5, type CompressResult } from './compressor/index.js';
import { assemblePayload } from './organizer.js';
import { findSessionIndex } from '../session/store.js';
import type { LLMClient } from '../llm/client.js';

export class ContextService extends Effect.Service<ContextService>()('Context', {
  effect: Effect.gen(function* () {
    return {
      /**
       * Called at the end of each agent turn. Uses the cheap O(1) gate from
       * `index.tokenCountEstimate` (maintained incrementally by recordX +
       * appendProjection) instead of rebuilding the full LLM view just to
       * count tokens. The Compressor itself does the precise accounting when
       * it actually needs to act.
       */
      appendTurnEnd: (sessionId: string, llm: LLMClient | null = null, config?: ContextConfig): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const cfg = config ?? getContextConfig();
          const idx = findSessionIndex(sessionId);
          const usage = idx?.tokenCountEstimate ?? 0;
          if (usage > cfg.defaultMaxTokens * cfg.thresholds.budgetReduction) {
            return await run(sessionId, usage, llm, cfg);
          }
          return { didCompress: false, released: 0 };
        }),

      /**
       * Build the message array to send to the LLM next. Uses the projection
       * pipeline (raw JSONL → applyProjections → L1 → L3 → fitToBudget).
       *
       * The optional `pendingUser` lets the caller append the about-to-be-sent
       * user message; if omitted, only the persisted history is returned.
       */
      build: (sessionId: string, pendingUser?: Message, pinned: Message[] = [], config?: ContextConfig): Effect.Effect<Message[]> =>
        Effect.sync(() => {
          const cfg = config ?? getContextConfig();
          return assemblePayload(sessionId, pendingUser ?? null, pinned, cfg);
        }),

      compress: (sessionId: string, llm: LLMClient | null = null, config?: ContextConfig): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const cfg = config ?? getContextConfig();
          return await runL5(sessionId, cfg, llm);
        }),
    };
  }),
}) {}

