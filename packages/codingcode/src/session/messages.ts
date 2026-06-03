import { join } from 'path';
import type { Message } from '../core/types.js';
import type { SessionEvent, AssistantEvent, TokenUsage } from './types.js';
import { readHistory, resolveSessionDir } from './io.js';

/**
 * Compute hidden UUID set from hide/unhide/summary events.
 * Reused by buildMessagesFromEvents and readUIHistory for consistent filtering.
 */
export function applyVisibilityEvents(events: SessionEvent[]): Set<string> {
  const hidden = new Set<string>();
  const hideEffects = new Map<string, Set<string>>();

  for (const ev of events) {
    switch (ev.type) {
      case 'hide': {
        let effect: Set<string>;
        if (ev.kind === 'message') {
          effect = new Set([ev.targetUuid]);
        } else {
          effect = new Set<string>();
          for (const prior of events) {
            if (prior === ev) break;
            if ('turnId' in prior && prior.turnId >= ev.throughTurnId && 'uuid' in prior) {
              effect.add((prior as any).uuid);
            }
          }
        }
        hideEffects.set(ev.uuid, effect);
        for (const u of effect) hidden.add(u);
        break;
      }
      case 'unhide': {
        const effect = hideEffects.get(ev.targetHideUuid);
        if (effect) {
          for (const u of effect) hidden.delete(u);
        }
        break;
      }
      case 'summary': {
        for (const u of ev.replaces) hidden.add(u);
        break;
      }
    }
  }

  return hidden;
}

export function buildMessagesFromEvents(events: SessionEvent[]): Message[] {
  const hidden = applyVisibilityEvents(events);

  // Collect visible events
  const visible: SessionEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'hide' || ev.type === 'unhide') continue;
    if ('uuid' in ev && hidden.has((ev as any).uuid)) continue;
    visible.push(ev);
  }

  // Convert visible events to Message[]
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
          (msg as any).tool_calls = event.toolCalls.map((tc: any) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
        }
        if (ev.usage) (msg as any).usage = ev.usage;
        messages.push(msg);
        break;
      }
      case 'tool_result':
        messages.push({ role: 'tool', content: event.output, tool_call_id: event.toolCallId, tool_name: event.toolName } as any);
        break;
      case 'summary':
        messages.push({ role: 'system', name: 'compacted_history', content: event.summaryText });
        break;
    }
  }

  // Collect all resolved tool_call_ids
  const resolvedIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool') resolvedIds.add((m as any).tool_call_id);
  }

  // Identify which assistant messages have all their tool_calls resolved
  const validAssistantIds = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const tcs = (m as any).tool_calls as Array<{ id: string }> | undefined;
    if (!tcs || tcs.length === 0) continue;
    if (tcs.every((tc) => resolvedIds.has(tc.id))) {
      for (const tc of tcs) validAssistantIds.add(tc.id);
    }
  }

  // Remove assistant messages with unresolved tool_calls, and orphaned tool results
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

  // Merge adjacent messages with the same non-system role to keep a valid LLM sequence.
  // Tool messages must not be merged (each needs its own tool_call_id).
  // Assistant messages with tool_calls must also not be merged.
  for (let i = filtered.length - 1; i > 0; i--) {
    if (filtered[i].role === filtered[i - 1].role && filtered[i].role !== 'system') {
      if (filtered[i].role === 'tool') continue;
      if (filtered[i].role === 'assistant' && (filtered[i] as any).tool_calls?.length > 0) continue;
      filtered[i - 1].content += '\n\n' + filtered[i].content;
      filtered.splice(i, 1);
    }
  }

  return filtered;
}

/**
 * View assembly: read events → apply summary/hide filtering → produce Message[].
 */
export function buildMessages(path: string): Message[] {
  const events = readHistory(path);
  return buildMessagesFromEvents(events);
}

/**
 * Find the usage of the last visible assistant event in the session history.
 * Used to restore the precise token anchor after rollback/fork.
 */
export function findLastVisibleAssistantUsage(path: string): TokenUsage | undefined {
  const events = readHistory(path);
  const messages = buildMessagesFromEvents(events);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const usage = (m as any).usage as TokenUsage | undefined;
    if (usage) return usage;
  }
  return undefined;
}

export function sessionEventsToTurns(events: SessionEvent[]): Array<{ id: string; items: object[]; status: string }> {
  const turnsMap = new Map<number, { id: string; items: object[]; status: string }>();
  for (const event of events) {
    if (event.type === 'session_meta') continue;
    if (event.type === 'summary' || event.type === 'hide' || event.type === 'unhide' || event.type === 'title' || event.type === 'tool_budget') continue;
    let turn = turnsMap.get(event.turnId);
    if (!turn) {
      turn = { id: String(event.turnId), items: [], status: 'completed' };
      turnsMap.set(event.turnId, turn);
    }
    switch (event.type) {
      case 'user':
        turn.items.push({ id: event.uuid, type: 'message', role: 'user', content: event.content });
        break;
      case 'assistant':
        if (event.content) {
          turn.items.push({ id: event.uuid, type: 'message', role: 'assistant', content: event.content });
        }
        for (const tc of event.toolCalls ?? []) {
          const args = tc.arguments ?? {};
          turn.items.push({ id: tc.id, type: 'tool_call', name: tc.name, args, status: 'approved' });
        }
        break;
      case 'tool_result': {
        const item: Record<string, unknown> = { id: event.uuid, type: 'tool_result', callId: event.toolCallId, name: event.toolName, output: event.output };
        turn.items.push(item);
        break;
      }
    }
  }
  return [...turnsMap.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

export function readUIHistory(sessionId: string): Array<{ id: string; items: object[]; status: string }> {
  const dir = resolveSessionDir(sessionId);
  if (!dir) return [];
  const jsonlPath = join(dir, `${sessionId}.jsonl`);
  const events = readHistory(jsonlPath);
  const hidden = applyVisibilityEvents(events);
  const visibleEvents = events.filter((ev) => {
    if (ev.type === 'hide' || ev.type === 'unhide') return false;
    if ('uuid' in ev && hidden.has((ev as any).uuid)) return false;
    return true;
  });
  return sessionEventsToTurns(visibleEvents);
}
