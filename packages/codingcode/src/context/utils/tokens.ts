import type { Message } from '../../core/types.js';

export function estimateMessageTokens(m: Message): number {
  let tokens = estimateTokensForContent(m.content ?? '');
  tokens += estimateTokensForContent(m.role);
  if (m.name) tokens += estimateTokensForContent(m.name);
  if (m.tool_call_id) tokens += estimateTokensForContent(m.tool_call_id);
  if (m.tool_name) tokens += estimateTokensForContent(m.tool_name);
  // OpenAI chat format fixed overhead per message (role tag, content key, delimiters)
  tokens += 4;
  return tokens;
}

export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateMessageTokens(m);
  }
  return total;
}

export function estimateTokensForContent(content: string): number {
  let charCount = 0;
  for (const char of content) {
    charCount += char.charCodeAt(0) > 127 ? 3.5 : 1;
  }
  return Math.ceil(charCount / 3.5);
}
