import type { Message } from '../../core/types.js';

export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokensForContent(m.content);
  }
  return total;
}

export function estimateTokensForContent(content: string): number {
  let charCount = 0;
  for (const char of content) {
    charCount += char.charCodeAt(0) > 127 ? 1.5 : 1;
  }
  return Math.ceil(charCount / 3.5);
}
