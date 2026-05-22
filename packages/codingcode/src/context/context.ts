import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { getContextConfig } from './config.js';
import { estimateTokens } from './utils/tokens.js';
import { run, runL5, type CompressResult } from './compressor/index.js';

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

      appendTurnEnd: (sessionId: string, llm?: any): Effect.Effect<void> =>
        Effect.sync(() => {
          const msgs = getStore(sessionId);
          const config = getContextConfig();
          const usage = estimateTokens(msgs);
          if (usage > config.defaultMaxTokens * config.thresholds.budgetReduction) {
            run(sessionId, usage, llm, config);
          }
        }),

      build: (sessionId: string): Effect.Effect<Message[]> =>
        Effect.succeed([...getStore(sessionId)]),

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

      compress: (sessionId: string): Effect.Effect<CompressResult> =>
        Effect.sync(() => {
          const config = getContextConfig();
          return runL5(sessionId, config);
        }),
    };
  }),
}) {}
