import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import { buildMessagesForQuery } from './projection/build.js';
import { estimateTokens } from './utils/tokens.js';

export function assemblePayload(
  sessionId: string,
  pendingUser: Message,
  pinned: Message[],
  config: ContextConfig,
): Message[] {
  const enriched = buildMessagesForQuery(sessionId, config);
  const base = enriched.map((e) => e.message);

  // Strip trailing incomplete assistant messages (API rejects them)
  const cleaned = stripOrphanToolCalls(base);

  const full = [...pinned, ...cleaned, pendingUser];
  return fitToBudget(full, config, pinned.length);
}

export function fitToBudget(
  messages: Message[],
  config: ContextConfig,
  pinnedCount: number = 0,
): Message[] {
  const budget = config.defaultMaxTokens - config.reservedTokens;
  const usage = estimateTokens(messages);
  if (usage <= budget) return messages;

  // Remove oldest non-pinned messages one by one until within budget
  const result = [...messages];
  while (result.length > pinnedCount && estimateTokens(result) > budget) {
    const removed = result.splice(pinnedCount, 1);
    if (removed.length === 0) break;
  }
  return result;
}

function stripOrphanToolCalls(messages: Message[]): Message[] {
  const resolvedIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) resolvedIds.add(m.tool_call_id);
  }
  while (messages.length > 0) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') break;
    const tcs = last.tool_calls;
    if (!tcs || tcs.length === 0) break;
    if (tcs.every((tc) => resolvedIds.has(tc.id))) break;
    messages.pop();
  }
  return messages;
}
