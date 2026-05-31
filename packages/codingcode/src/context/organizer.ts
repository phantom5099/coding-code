import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import { resolveSessionDir, buildMessages } from '../session/store.js';
import { join } from 'path';

export function assemblePayload(
  sessionId: string,
  encodedProjectPath: string,
  pendingUser: Message | null,
  pinned: Message[],
  config: ContextConfig,
): Message[] {
  const dir = resolveSessionDir(sessionId);
  if (!dir) throw new Error(`Session ${sessionId} not found`);
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const base = buildMessages(jsonlPath);

  // Strip trailing incomplete assistant messages (API rejects them)
  const cleaned = stripOrphanToolCalls(base);

  const full = pendingUser ? [...pinned, ...cleaned, pendingUser] : [...pinned, ...cleaned];
  return full;
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
