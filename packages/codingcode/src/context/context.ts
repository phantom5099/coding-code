import { Effect } from 'effect';
import { join } from 'path';
import { homedir } from 'os';
import type { Message } from '../core/types.js';
import { getContextConfig, type ContextConfig } from './config.js';
import { run, compactWithLLM, type CompressResult } from './compressor/index.js';
import { assemblePayload } from './organizer.js';
import { findSessionIndex } from '../session/store.js';
import type { LLMClient } from '../llm/client.js';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

export class ContextService extends Effect.Service<ContextService>()('Context', {
  effect: Effect.gen(function* () {
    return {
      /**
       * Called at the end of each agent turn. Uses the cheap O(1) gate from
       * `index.tokenCountEstimate` (maintained incrementally by recordX +
       * summary events) instead of rebuilding the full LLM view just to
       * count tokens. The Compressor itself does the precise accounting when
       * it actually needs to act.
       */
      appendTurnEnd: (sessionId: string, encodedProjectPath: string, llm: LLMClient | null = null, config?: ContextConfig): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const cfg = config ?? getContextConfig();
          const idx = findSessionIndex(sessionId);
          const usage = idx?.tokenCountEstimate ?? 0;
          if (usage > cfg.defaultMaxTokens * cfg.thresholds.prune) {
            return await run(sessionId, PROJECT_BASE, encodedProjectPath, usage, llm, cfg);
          }
          return { didCompress: false, released: 0 };
        }),

      /**
       * Build the message array to send to the LLM next. Uses the event
       * pipeline (raw JSONL → summary/hide filter → fitToBudget).
       *
       * The optional `pendingUser` lets the caller append the about-to-be-sent
       * user message; if omitted, only the persisted history is returned.
       */
      build: (sessionId: string, encodedProjectPath: string, pendingUser?: Message, pinned: Message[] = [], config?: ContextConfig): Effect.Effect<Message[]> =>
        Effect.sync(() => {
          const cfg = config ?? getContextConfig();
          return assemblePayload(sessionId, encodedProjectPath, pendingUser ?? null, pinned, cfg);
        }),

      compress: (sessionId: string, encodedProjectPath: string, llm: LLMClient | null = null, config?: ContextConfig): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const cfg = config ?? getContextConfig();
          return await compactWithLLM(sessionId, PROJECT_BASE, encodedProjectPath, cfg, llm);
        }),
    };
  }),
}) {}

