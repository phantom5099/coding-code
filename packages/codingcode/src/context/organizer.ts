import type { ContextConfig } from './config.js';
import type { Message } from '../core/types.js';
import { resolveSessionDir, readHistory, applyVisibilityEvents, findSessionIndex, buildMessagesFromEvents } from '../session/store.js';
import { estimateMessageTokens } from './utils/tokens.js';
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
  const events = readHistory(jsonlPath);

  const hidden = applyVisibilityEvents(events);
  const visible = events.filter((ev) => {
    if (ev.type === 'hide' || ev.type === 'unhide') return false;
    if ('uuid' in ev && hidden.has((ev as any).uuid)) return false;
    return true;
  });

  const idx = findSessionIndex(sessionId);
  const currentTurnId = idx?.currentTurnId ?? 0;
  const compacted = applyMemoryCompaction(visible, currentTurnId, config);

  const messages = buildMessagesFromEvents(compacted as any);

  const full = pendingUser ? [...pinned, ...messages, pendingUser] : [...pinned, ...messages];
  return full;
}

function applyMemoryCompaction(
  events: any[],
  currentTurnId: number,
  config: ContextConfig,
): any[] {
  let compacted = pruneToolResults(events, currentTurnId, config);
  compacted = snipEvents(compacted, config);
  return compacted;
}

export function pruneToolResults(
  events: any[],
  currentTurnId: number,
  config: ContextConfig,
): any[] {
  const replacement = '[Old tool result content cleared]';
  const turnCutoff = currentTurnId - config.prefixTurnsProtected - 1;

  const candidates = events
    .filter((ev) => {
      if (ev.type !== 'tool_result') return false;
      if (ev.turnId > turnCutoff) return false;
      if (config.toolsExemptFromPrune.includes(ev.toolName ?? '')) return false;
      return true;
    })
    .sort((a, b) => b.turnId - a.turnId || (b.output?.length ?? 0) - (a.output?.length ?? 0));

  const toolResultToMessage = (tool: any): Message => ({
    role: 'tool',
    content: tool.output,
    tool_call_id: tool.toolCallId,
    tool_name: tool.toolName,
  } as any);

  let recentTokenSum = 0;
  const prunable: any[] = [];
  for (const tool of candidates) {
    const t = estimateMessageTokens(toolResultToMessage(tool));
    if (recentTokenSum < config.pruneProtectedTokens) {
      recentTokenSum += t;
      continue;
    }
    prunable.push(tool);
  }

  let released = 0;
  const prunedUuids = new Set<string>();
  for (const tool of prunable) {
    if (released >= config.pruneMinRelease) break;
    const originalTokens = estimateMessageTokens(toolResultToMessage(tool));
    const replacementTokens = estimateMessageTokens(toolResultToMessage({ ...tool, output: replacement }));
    released += originalTokens - replacementTokens;
    prunedUuids.add(tool.uuid);
  }

  return events.map((ev) => {
    if (ev.type === 'tool_result' && prunedUuids.has(ev.uuid)) {
      return { ...ev, output: replacement };
    }
    return ev;
  });
}

export function snipEvents(events: any[], config: ContextConfig): any[] {
  if (events.length <= config.snipMaxMessages) return events;

  const keepFrom = events.length - config.snipMaxMessages;
  let boundary = keepFrom;
  // Advance to the next user boundary so we keep complete turns from the tail
  while (boundary < events.length && events[boundary]?.type !== 'user') {
    boundary++;
  }
  if (boundary >= events.length) return events;

  const snippedCount = boundary;
  const summary = {
    type: 'summary',
    uuid: '',
    replaces: [],
    summaryText: `[${snippedCount} messages snipped from conversation middle]`,
    method: 'context-collapse',
    timestamp: '',
  };

  return [summary, ...events.slice(boundary)];
}

