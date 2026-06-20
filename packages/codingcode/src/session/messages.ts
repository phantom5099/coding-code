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

// --- Internal: visibility computation for LLM context ---

function applyVisibilityEvents(events: SessionEvent[]): {
  hiddenTurnIds: Set<number>;
  hiddenOpUuids: Set<string>;
  compactedTurnIds: Set<number>;
} {
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

// --- LLM context path: filter + format ---

/** Filter events for LLM context building: hide summary-covered turns, apply rollback */
export function filterForContext(events: SessionEvent[]): {
  visible: SessionEvent[];
  compactedTurnIds: Set<number>;
} {
  const { hiddenTurnIds, hiddenOpUuids, compactedTurnIds } = applyVisibilityEvents(events);
  const visible = events.filter((ev) => {
    if (ev.type === 'session_meta') return false;
    if (ev.type === 'rollback') return false;
    if (ev.type === 'compact') return false;
    if (ev.type === 'summary' && hiddenOpUuids.has(ev.uuid)) return false;
    if ('turnId' in ev && hiddenTurnIds.has(ev.turnId)) return false;
    return true;
  }) as SessionEvent[];
  return { visible, compactedTurnIds };
}

/** Format filtered events as LLM messages, with micro-compaction for compacted turns */
export function formatAsMessages(
  events: SessionEvent[],
  compactedTurnIds?: Set<number>
): Message[] {
  // Pass 1: event → message conversion + collect resolvedIds
  const messages: Message[] = [];
  const resolvedIds = new Set<string>();
  for (const event of events) {
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
          compactedTurnIds?.has(event.turnId) &&
          COMPACTABLE_TOOLS.has(event.toolName.toLowerCase()) &&
          event.output.length > MICRO_COMPACT_MIN_CHARS
        ) {
          output = `[Earlier: used ${event.toolName}]`;
        }
        resolvedIds.add(event.toolCallId);
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

  // Pass 2: tool call pairing validation + filter
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

  // Pass 3: merge adjacent same-role messages
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

// --- UI path: filter + format ---

/** Filter events for UI display: only hide rollback'd turns and rolled-back summaries */
export function filterForUI(events: SessionEvent[]): SessionEvent[] {
  const rollbackHiddenTurnIds = new Set<number>();
  const rollbackHiddenOpUuids = new Set<string>();

  for (const ev of events) {
    if (ev.type !== 'rollback') continue;
    for (const prior of events) {
      if (prior === ev) break;
      if ('turnId' in prior && prior.turnId >= ev.throughTurnId) {
        rollbackHiddenTurnIds.add(prior.turnId);
      }
      if (prior.type === 'summary' || prior.type === 'compact') {
        if ((prior as SummaryEvent | CompactEvent).endTurnId >= ev.throughTurnId) {
          rollbackHiddenOpUuids.add((prior as SummaryEvent | CompactEvent).uuid);
        }
      }
    }
  }

  return events.filter((ev) => {
    if (ev.type === 'rollback') return false;
    if (ev.type === 'summary' && rollbackHiddenOpUuids.has((ev as SummaryEvent).uuid)) return false;
    if (ev.type === 'compact' && rollbackHiddenOpUuids.has((ev as CompactEvent).uuid)) return false;
    if ('turnId' in ev && rollbackHiddenTurnIds.has(ev.turnId)) return false;
    return true;
  }) as SessionEvent[];
}

// --- Shared helpers ---

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
    if (event.type === 'compact' || event.type === 'rollback') continue;

    if (event.type === 'summary') {
      let turn = turnsMap.get(event.endTurnId);
      if (!turn) {
        turn = { id: String(event.endTurnId), items: [], status: 'completed' };
        turnsMap.set(event.endTurnId, turn);
      }
      turn.items.push({
        id: `summary-${event.uuid}`,
        type: 'summary',
        content: event.summaryText,
        startTurnId: event.startTurnId,
        endTurnId: event.endTurnId,
      });
      continue;
    }

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
  const visibleEvents = filterForUI(events);
  return sessionEventsToTurns(visibleEvents);
}

export function findLastVisibleAssistantUsage(path: string): TokenUsage | undefined {
  const events = readHistory(path);
  const { visible, compactedTurnIds } = filterForContext(events);
  const messages = formatAsMessages(visible, compactedTurnIds);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const usage = (m as any).usage as TokenUsage | undefined;
    if (usage) return usage;
  }
  return undefined;
}
