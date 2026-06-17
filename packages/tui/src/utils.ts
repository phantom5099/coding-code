import { randomBytes } from 'crypto';
import type { UIMessage } from './types.js';

type SessionEvent = {
  type: string;
  turnId?: number;
  content?: string;
  output?: string;
  model?: string;
  toolName?: string;
  toolCallId?: string;
};

export function generateId(): string {
  return randomBytes(8).toString('hex');
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function createTurnScopedIdGenerator() {
  const counters = new Map<string, number>();
  return (prefix: string, turnId: number): string => {
    const key = `${prefix}:${turnId}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return `${prefix}-${turnId}-${next}`;
  };
}

export function historyToUIMessages(history: SessionEvent[]): UIMessage[] {
  const messages: UIMessage[] = [];
  const nextId = createTurnScopedIdGenerator();

  for (const event of history) {
    switch (event.type) {
      case 'user': {
        if (event.turnId === undefined) break;
        messages.push({
          id: nextId('user', event.turnId),
          timestamp: Date.now(),
          role: 'user',
          content: event.content ?? '',
        });
        break;
      }
      case 'assistant': {
        if (event.turnId === undefined) break;
        messages.push({
          id: nextId('assistant', event.turnId),
          timestamp: Date.now(),
          role: 'assistant',
          content: event.content ?? '',
          model: event.model,
        });
        break;
      }
      case 'tool_result': {
        if (event.toolCallId === undefined) break;
        messages.push({
          id: `result-${event.toolCallId}`,
          timestamp: Date.now(),
          role: 'tool',
          content: event.output ?? '',
          toolName: event.toolName,
        });
        break;
      }
    }
  }
  return messages;
}
