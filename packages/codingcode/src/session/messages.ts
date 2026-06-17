import { join } from 'path';
import type { Message } from '../core/types.js';
import type {
  SessionEvent,
  AssistantEvent,
  SummaryEvent,
  CompactEvent,
  TokenUsage,
} from './types.js';
import { readHistory, resolveSessionDir } from './file-ops.js';
import { getContextConfig } from '../context/config.js';

const COMPACTABLE_TOOLS = new Set([
  'read_file',
  'execute_command',
  'search_code',
  'search_files',
  'web_search',
  'fetch_url',
  'write_file',
  'edit_file',
]);

const MICRO_COMPACT_MIN_CHARS = 120;

export interface VisibilityResult {
  hiddenTurnIds: Set<number>;
  hiddenOpUuids: Set<string>;
  compactedTurnIds: Set<number>;
}

export function applyVisibilityEvents(events: SessionEvent[]): VisibilityResult {
  const hiddenTurnIds = new Set<number>();
  const hiddenOpUuids = new Set<string>();
  const compactedTurnIds = new Set<number>();

  // First pass: find operation events revoked by rollback.
  for (const ev of events) {
    if (ev.type !== 'rollback') continue;
    for (const prior of events) {
      if (prior === ev) break;
      if (prior.type === 'summary' || prior.type === 'compact') {
        if (prior.endTurnId >= ev.throughTurnId) {
          hiddenOpUuids.add(prior.uuid);
        }
      }
    }
  }

  // Second pass: compute visible turn ranges.
  for (const ev of events) {
    switch (ev.type) {
      case 'rollback': {
        for (const prior of events) {
          if (prior === ev) break;
          if ('turnId' in prior && prior.turnId >= ev.throughTurnId) {
            hiddenTurnIds.add(prior.turnId);
          }
        }
        break;
      }
      case 'summary': {
        if (hiddenOpUuids.has(ev.uuid)) break;
        for (let t = ev.startTurnId; t <= ev.endTurnId; t++) {
          hiddenTurnIds.add(t);
        }
        break;
      }
      case 'compact': {
        if (hiddenOpUuids.has(ev.uuid)) break;
        for (let t = ev.startTurnId; t <= ev.endTurnId; t++) {
          compactedTurnIds.add(t);
        }
        break;
      }
    }
  }

  return { hiddenTurnIds, hiddenOpUuids, compactedTurnIds };
}

export function buildMessagesFromEvents(
  events: SessionEvent[],
  externalCompactedTurnIds?: Set<number>
): Message[] {
  const {
    hiddenTurnIds,
    hiddenOpUuids,
    compactedTurnIds: derivedIds,
  } = applyVisibilityEvents(events);
  const compactedTurnIds = externalCompactedTurnIds ?? derivedIds;

  const visible: SessionEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'rollback') continue;
    if (ev.type === 'compact') continue;
    if (ev.type === 'summary' && hiddenOpUuids.has(ev.uuid)) continue;
    if ('turnId' in ev && hiddenTurnIds.has(ev.turnId)) continue;
    visible.push(ev);
  }

  const messages: Message[] = [];
  for (const event of visible) {
    switch (event.type) {
      case 'user':
        messages.push({ role: 'user', content: event.content });
        break;
      case 'assistant': {
        const ev = event as AssistantEvent;
        const msg: Message = { role: 'assistant', content: event.content };
        if (event.toolCalls && event.toolCalls.length > 0) {
          (msg as any).tool_calls = event.toolCalls.map((tc: any) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }));
        }
        if (ev.usage) (msg as any).usage = ev.usage;
        messages.push(msg);
        break;
      }
      case 'tool_result': {
        let output = event.output;
        if (
          compactedTurnIds.has(event.turnId) &&
          COMPACTABLE_TOOLS.has(event.toolName.toLowerCase()) &&
          event.output.length > MICRO_COMPACT_MIN_CHARS
        ) {
          output = `[Earlier: used ${event.toolName}]`;
        }
        messages.push({
          role: 'tool',
          content: output,
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
        } as any);
        break;
      }
      case 'summary':
        messages.push({ role: 'system', name: 'compacted_history', content: event.summaryText });
        break;
    }
  }

  const resolvedIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool') resolvedIds.add((m as any).tool_call_id);
  }

  const validAssistantIds = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const tcs = (m as any).tool_calls as Array<{ id: string }> | undefined;
    if (!tcs || tcs.length === 0) continue;
    if (tcs.every((tc) => resolvedIds.has(tc.id))) {
      for (const tc of tcs) validAssistantIds.add(tc.id);
    }
  }

  const filtered = messages.filter((m) => {
    if (m.role === 'assistant') {
      const tcs = (m as any).tool_calls as Array<{ id: string }> | undefined;
      if (!tcs || tcs.length === 0) return true;
      return tcs.every((tc) => resolvedIds.has(tc.id));
    }
    if (m.role === 'tool') {
      return validAssistantIds.has((m as any).tool_call_id);
    }
    return true;
  });

  for (let i = filtered.length - 1; i > 0; i--) {
    const curr = filtered[i]!;
    const prev = filtered[i - 1]!;
    if (curr.role === prev.role && curr.role !== 'system') {
      if (curr.role === 'tool') continue;
      if (curr.role === 'assistant' && (curr as any).tool_calls?.length > 0) continue;
      prev.content += '\n\n' + curr.content;
      filtered.splice(i, 1);
    }
  }

  return filtered;
}

export function buildMessages(path: string): Message[] {
  const events = readHistory(path);
  return buildMessagesFromEvents(events);
}

export function findLastVisibleAssistantUsage(path: string): TokenUsage | undefined {
  const events = readHistory(path);
  const messages = buildMessagesFromEvents(events);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const usage = (m as any).usage as TokenUsage | undefined;
    if (usage) return usage;
  }
  return undefined;
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

export function sessionEventsToTurns(
  events: SessionEvent[]
): Array<{ id: string; items: object[]; status: string }> {
  const turnsMap = new Map<number, { id: string; items: object[]; status: string }>();
  const nextId = createTurnScopedIdGenerator();

  for (const event of events) {
    if (event.type === 'session_meta') continue;
    if (event.type === 'summary' || event.type === 'compact' || event.type === 'rollback') continue;
    let turn = turnsMap.get(event.turnId);
    if (!turn) {
      turn = { id: String(event.turnId), items: [], status: 'completed' };
      turnsMap.set(event.turnId, turn);
    }
    switch (event.type) {
      case 'user':
        turn.items.push({
          id: nextId('user', event.turnId),
          type: 'message',
          role: 'user',
          content: event.content,
        });
        break;
      case 'assistant':
        if (event.content) {
          turn.items.push({
            id: nextId('assistant', event.turnId),
            type: 'message',
            role: 'assistant',
            content: event.content,
          });
        }
        for (const tc of event.toolCalls ?? []) {
          const args = tc.arguments ?? {};
          turn.items.push({
            id: tc.id,
            type: 'tool_call',
            name: tc.name,
            args,
            status: 'approved',
          });
        }
        break;
      case 'tool_result': {
        const item: Record<string, unknown> = {
          id: `result-${event.toolCallId}`,
          type: 'tool_result',
          callId: event.toolCallId,
          name: event.toolName,
          output: event.output,
        };
        turn.items.push(item);
        break;
      }
    }
  }
  return [...turnsMap.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

export function readUIHistory(
  sessionId: string
): Array<{ id: string; items: object[]; status: string }> {
  const dir = resolveSessionDir(sessionId);
  if (!dir) return [];
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const events = readHistory(jsonlPath);
  const { hiddenTurnIds, hiddenOpUuids } = applyVisibilityEvents(events);
  const visibleEvents = events.filter((ev) => {
    if (ev.type === 'rollback') return false;
    if (ev.type === 'summary' && hiddenOpUuids.has((ev as SummaryEvent).uuid)) return false;
    if (ev.type === 'compact' && hiddenOpUuids.has((ev as CompactEvent).uuid)) return false;
    if ('turnId' in ev && hiddenTurnIds.has(ev.turnId)) return false;
    return true;
  });
  return sessionEventsToTurns(visibleEvents);
}
