import { randomBytes } from 'crypto';
import type { UIMessage } from './types.js';

type SessionEvent = {
  type: string;
  uuid: string;
  content?: string;
  output?: string;
  timestamp: string;
  model?: string;
  toolName?: string;
  toolCalls?: any[];
};

export function generateId(): string {
  return randomBytes(8).toString('hex');
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function historyToUIMessages(history: SessionEvent[]): UIMessage[] {
  const messages: UIMessage[] = [];
  for (const event of history) {
    switch (event.type) {
      case 'user':
        messages.push({
          id: event.uuid,
          timestamp: new Date(event.timestamp).getTime(),
          role: 'user',
          content: event.content ?? '',
        });
        break;
      case 'assistant':
        messages.push({
          id: event.uuid,
          timestamp: new Date(event.timestamp).getTime(),
          role: 'assistant',
          content: event.content ?? '',
          model: event.model,
        });
        break;
      case 'tool_result':
        messages.push({
          id: event.uuid,
          timestamp: new Date(event.timestamp).getTime(),
          role: 'tool',
          content: event.output ?? '',
          toolName: event.toolName,
        });
        break;
    }
  }
  return messages;
}


