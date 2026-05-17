import { Effect } from 'effect';
import type { Message, ToolCall } from '../core/types.js';
import { compactMessages, type CompressResult } from './compaction.js';

export class ContextService extends Effect.Service<ContextService>()('Context', {
  effect: Effect.gen(function* () {
    const messages: Message[] = [];
    const budget = 200_000;

    const self = {
      addUser: (content: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          messages.push({ role: 'user', content });
          if (messages.length > 0 && self._overThreshold()) {
            self._doCompact();
          }
        }),

      addAssistant: (content: string, toolCalls?: ToolCall[]): Effect.Effect<void> =>
        Effect.sync(() => {
          const msg: Message = { role: 'assistant', content };
          if (toolCalls && toolCalls.length > 0) {
            (msg as any).tool_calls = toolCalls;
          }
          messages.push(msg);
          if (self._overThreshold()) {
            self._doCompact();
          }
        }),

      addToolResult: (toolCallId: string, output: string, toolName?: string): Effect.Effect<void> =>
        Effect.sync(() => {
          messages.push({ role: 'tool', content: output, tool_call_id: toolCallId, tool_name: toolName });
        }),

      build: (): Effect.Effect<Message[]> =>
        Effect.succeed([...messages]),

      getMessages: (): Effect.Effect<Message[]> =>
        Effect.succeed([...messages]),

      setMessages: (msgs: Message[]): Effect.Effect<void> =>
        Effect.sync(() => {
          messages.length = 0;
          messages.push(...msgs);
        }),

      clear: (): Effect.Effect<void> =>
        Effect.sync(() => { messages.length = 0; }),

      compress: (): Effect.Effect<CompressResult> =>
        Effect.sync(() => {
          const result = compactMessages(messages, budget);
          if (result.ok && result.value.didCompress) {
            messages.length = 0;
            messages.push(...result.value.messages);
          }
          return result.ok ? result.value : { messages, didCompress: false };
        }),

      get length(): number {
        return messages.length;
      },

      _overThreshold: (): boolean => {
        let total = 0;
        for (const m of messages) {
          for (const char of m.content) {
            total += char.charCodeAt(0) > 127 ? 1.5 : 1;
          }
        }
        return Math.ceil(total / 3.5) > budget * 0.9;
      },

      _doCompact: (): void => {
        const result = compactMessages(messages, budget);
        if (result.ok && result.value.didCompress) {
          messages.length = 0;
          messages.push(...result.value.messages);
        }
      },
    };

    return self;
  }),
}) {}

export type { CompressResult } from './compaction.js';
