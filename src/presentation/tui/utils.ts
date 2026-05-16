import { randomBytes } from 'crypto';
import type { SessionEvent } from '../../session/types';
import type { UIMessage } from './types';

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
          content: event.content,
        });
        break;
      case 'assistant':
        messages.push({
          id: event.uuid,
          timestamp: new Date(event.timestamp).getTime(),
          role: 'assistant',
          content: event.content,
          model: event.model,
        });
        break;
      case 'tool_result':
        messages.push({
          id: event.uuid,
          timestamp: new Date(event.timestamp).getTime(),
          role: 'tool',
          content: event.output,
          toolName: event.toolName,
        });
        break;
    }
  }
  return messages;
}

export interface ParsedBlock {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

export function parseCodeBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = text.split('\n');
  let currentText = '';
  let inCode = false;
  let codeContent = '';
  let codeLang = 'text';

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'code', content: codeContent.trimEnd(), language: codeLang });
        inCode = false;
        codeContent = '';
      } else {
        if (currentText) {
          blocks.push({ type: 'text', content: currentText.trimEnd() });
          currentText = '';
        }
        codeLang = line.replace('```', '').trim() || 'text';
        inCode = true;
      }
    } else if (inCode) {
      codeContent += line + '\n';
    } else {
      currentText += line + '\n';
    }
  }

  if (currentText) {
    blocks.push({ type: 'text', content: currentText.trimEnd() });
  }
  if (inCode && codeContent) {
    blocks.push({ type: 'code', content: codeContent.trimEnd(), language: codeLang });
  }

  return blocks;
}
