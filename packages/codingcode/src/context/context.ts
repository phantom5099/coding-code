import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { getContextConfig } from './config.js';
import { run, runL5, type CompressResult } from './compressor/index.js';
import { assemblePayload } from './organizer.js';
import { findSessionIndex } from '../session/store.js';
import type { LLMClient } from '../llm/client.js';

/**
 * Per-session in-memory message log. This is the *append buffer*; the
 * persistent truth lives in JSONL. `build()` ignores this buffer and
 * reconstructs the LLM view from JSONL + projections every call so that
 * compression effects always become visible.
 */
const stores = new Map<string, Message[]>();

function getStore(sessionId: string): Message[] {
  let msgs = stores.get(sessionId);
  if (!msgs) {
    msgs = [];
    stores.set(sessionId, msgs);
  }
  return msgs;
}

export class ContextService extends Effect.Service<ContextService>()('Context', {
  effect: Effect.gen(function* () {
    return {
      addUser: (sessionId: string, content: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const msgs = getStore(sessionId);
          msgs.push({ role: 'user', content });
        }),

      addAssistant: (sessionId: string, content: string, toolCalls?: ToolCall[]): Effect.Effect<void> =>
        Effect.sync(() => {
          const msgs = getStore(sessionId);
          const msg: Message = { role: 'assistant', content };
          if (toolCalls && toolCalls.length > 0) {
            (msg as any).tool_calls = toolCalls;
          }
          msgs.push(msg);
        }),

      addToolResult: (sessionId: string, toolCallId: string, output: string, toolName?: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const msgs = getStore(sessionId);
          msgs.push({ role: 'tool', content: output, tool_call_id: toolCallId, tool_name: toolName });
        }),

      /**
       * Called at the end of each agent turn. Uses the cheap O(1) gate from
       * `index.tokenCountEstimate` (maintained incrementally by recordX +
       * appendProjection) instead of rebuilding the full LLM view just to
       * count tokens. The Compressor itself does the precise accounting when
       * it actually needs to act.
       */
      appendTurnEnd: (sessionId: string, llm: LLMClient | null = null): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const config = getContextConfig();
          const idx = findSessionIndex(sessionId);
          const usage = idx?.tokenCountEstimate ?? 0;
          if (usage > config.defaultMaxTokens * config.thresholds.budgetReduction) {
            return await run(sessionId, usage, llm, config);
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
      build: (sessionId: string, pendingUser?: Message, pinned: Message[] = []): Effect.Effect<Message[]> =>
        Effect.sync(() => {
          const config = getContextConfig();
          try {
            return assemblePayload(sessionId, pendingUser ?? null, pinned, config);
          } catch {
            // Session not yet persisted (e.g. very first call before recordUser):
            // fall back to in-memory log.
            return [...getStore(sessionId)];
          }
        }),

      getMessages: (sessionId: string): Effect.Effect<Message[]> =>
        Effect.succeed([...getStore(sessionId)]),

      setMessages: (sessionId: string, msgs: Message[]): Effect.Effect<void> =>
        Effect.sync(() => {
          const store = getStore(sessionId);
          store.length = 0;
          store.push(...msgs);
        }),

      clear: (sessionId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const store = stores.get(sessionId);
          if (store) store.length = 0;
        }),

      compress: (sessionId: string, llm: LLMClient | null = null): Effect.Effect<CompressResult> =>
        Effect.promise(async () => {
          const config = getContextConfig();
          return await runL5(sessionId, config, llm);
        }),
    };
  }),
}) {}

