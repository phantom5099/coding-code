import type { Message } from '../core/types.js';
import { Result } from '../core/result.js';

export interface CompressResult {
  messages: Message[];
  didCompress: boolean;
  summary?: string;
  replacedRange?: [number, number];
  messageCount?: number;
}

function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    let charCount = 0;
    for (const char of m.content) {
      charCount += char.charCodeAt(0) > 127 ? 1.5 : 1;
    }
    total += Math.ceil(charCount / 3.5);
  }
  return total;
}

function truncateOldToolOutputs(messages: Message[]): Message[] {
  const ROUNDS_KEEP = 10;
  const assistantIndices = messages
    .map((m, i) => (m.role === 'assistant' ? i : -1))
    .filter((i) => i !== -1);
  const cutoffIndex =
    assistantIndices[Math.max(0, assistantIndices.length - ROUNDS_KEEP)] ?? 0;

  return messages.map((m, i) => {
    if (i >= cutoffIndex) return m;
    if (m.role === 'tool' && m.content.length > 200) {
      return { ...m, content: m.content.slice(0, 200) + '...[truncated]' };
    }
    return m;
  });
}

function summarizeOldest(messages: Message[]): Message[] {
  const KEEP_RECENT = 15;
  if (messages.length <= KEEP_RECENT) return messages;

  const oldMessages = messages.slice(0, messages.length - KEEP_RECENT);
  const recentMessages = messages.slice(messages.length - KEEP_RECENT);

  const parts = oldMessages
    .filter((m) => m.role === 'assistant' && m.content.length > 10)
    .map((m) => m.content.slice(0, 100));

  const summaryText =
    `[Previous conversation summary]\n` +
    `${oldMessages.length} earlier messages: ` +
    parts.join('; ').slice(0, 500);

  return [{ role: 'user', content: summaryText }, ...recentMessages];
}

export function compactMessages(
  messages: Message[],
  budget: number,
  threshold = 0.9,
): Result<CompressResult> {
  if (messages.length === 0) {
    return Result.ok({ messages: [], didCompress: false });
  }

  const limit = budget * threshold;
  let currentTokens = estimateTokens(messages);
  if (currentTokens <= limit) {
    return Result.ok({ messages: [...messages], didCompress: false });
  }

  let compressed = truncateOldToolOutputs(messages);
  currentTokens = estimateTokens(compressed);
  if (currentTokens <= limit) {
    return Result.ok({ messages: compressed, didCompress: true });
  }

  compressed = summarizeOldest(compressed);
  const replacedRange: [number, number] = [0, messages.length - compressed.length + 1];
  const summary = compressed.find(
    (m) => m.role === 'user' && m.content.startsWith('[Previous conversation summary]'),
  )?.content ?? '';

  return Result.ok({
    messages: compressed,
    didCompress: true,
    summary,
    replacedRange,
    messageCount: messages.length - compressed.length + 1,
  });
}
