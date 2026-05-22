import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import { buildMessagesForQuery } from './projection/build.js';
import { estimateTokens, estimateTokensForContent } from './utils/tokens.js';

export function assemblePayload(
  sessionId: string,
  pendingUser: Message | null,
  pinned: Message[],
  config: ContextConfig,
): Message[] {
  const enriched = buildMessagesForQuery(sessionId, config);
  const base = enriched.map((e) => e.message);

  // Strip trailing incomplete assistant messages (API rejects them)
  const cleaned = stripOrphanToolCalls(base);

  const full = pendingUser ? [...pinned, ...cleaned, pendingUser] : [...pinned, ...cleaned];
  return fitToBudget(full, config, pinned.length);
}

export function fitToBudget(
  messages: Message[],
  config: ContextConfig,
  pinnedCount: number = 0,
): Message[] {
  const budget = config.defaultMaxTokens - config.reservedTokens;
  let usage = estimateTokens(messages);
  if (usage <= budget) return messages;

  const result = [...messages];
  let i = pinnedCount;
  while (i < result.length && usage > budget) {
    // Skip non-user messages that might have been left orphaned
    if (result[i]?.role !== 'user') { i++; continue; }

    // Find end of this user turn (next user message or array end)
    let end = i + 1;
    while (end < result.length && result[end]?.role !== 'user') {
      end++;
    }

    const removed = result.splice(i, end - i);
    usage -= removed.reduce((s, m) => s + estimateTokensForContent(m.content), 0);
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
