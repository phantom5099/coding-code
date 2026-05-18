import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { compactMessages, type CompressResult } from './compaction.js';

const stores = new Map<string, Message[]>();
const budget = 200_000;

function getStore(sessionId: string): Message[] {
  let msgs = stores.get(sessionId);
  if (!msgs) {
    msgs = [];
    stores.set(sessionId, msgs);
  }
  return msgs;
}

function overThreshold(msgs: Message[]): boolean {
  let total = 0;
  for (const m of msgs) {
    for (const char of m.content) {
      total += char.charCodeAt(0) > 127 ? 1.5 : 1;
    }
  }
  return Math.ceil(total / 3.5) > budget * 0.9;
}

function doCompact(msgs: Message[]): void {
  const result = compactMessages(msgs, budget);
  if (result.ok && result.value.didCompress) {
    msgs.length = 0;
    msgs.push(...result.value.messages);
  }
}

export class ContextService extends Effect.Service<ContextService>()('Context', {
  effect: Effect.gen(function* () {
    return {
      addUser: (sessionId: string, content: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const msgs = getStore(sessionId);
          msgs.push({ role: 'user', content });
          if (msgs.length > 0 && overThreshold(msgs)) {
            doCompact(msgs);
          }
        }),

      addAssistant: (sessionId: string, content: string, toolCalls?: ToolCall[]): Effect.Effect<void> =>
        Effect.sync(() => {
          const msgs = getStore(sessionId);
          const msg: Message = { role: 'assistant', content };
          if (toolCalls && toolCalls.length > 0) {
            (msg as any).tool_calls = toolCalls;
          }
          msgs.push(msg);
          if (overThreshold(msgs)) {
            doCompact(msgs);
          }
        }),

      addToolResult: (sessionId: string, toolCallId: string, output: string, toolName?: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const msgs = getStore(sessionId);
          msgs.push({ role: 'tool', content: output, tool_call_id: toolCallId, tool_name: toolName });
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
          const msgs = getStore(sessionId);
          const result = compactMessages(msgs, budget);
          if (result.ok && result.value.didCompress) {
            msgs.length = 0;
            msgs.push(...result.value.messages);
          }
          return result.ok ? result.value : { messages: [...msgs], didCompress: false };
        }),
    };
  }),
}) {}

export type { CompressResult } from './compaction.js';
