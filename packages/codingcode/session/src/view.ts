import { textPart } from '@codingcode/model';
import { isTurnScopedEvent, type SessionEvent, type StoredPart } from './events.js';

export type UITurnItem =
  | {
      id: string;
      type: 'message';
      role: 'user' | 'assistant';
      parts: StoredPart[];
      partial?: boolean;
    }
  | {
      id: string;
      type: 'tool_call';
      name: string;
      arguments: Record<string, unknown>;
      status: 'pending' | 'approved' | 'rejected' | 'running';
    }
  | {
      id: string;
      type: 'tool_result';
      callId: string;
      name: string;
      output: string;
      exitCode?: number;
      filePath?: string;
      diff?: string;
      insertions?: number;
      deletions?: number;
    }
  | {
      id: string;
      type: 'summary';
      content: string;
      startTurnId: number;
      endTurnId: number;
    }
  | { id: string; type: 'reasoning'; content: string; isVisible: boolean; partial?: boolean }
  | { id: string; type: 'error'; message: string; code?: string };

export interface UITurn {
  id: string;
  items: UITurnItem[];
  status: 'running' | 'completed' | 'error';
}

export function filterForUI(events: SessionEvent[]): SessionEvent[] {
  const rollbackHiddenTurnIds = new Set<number>();
  const rollbackHiddenOpUuids = new Set<string>();

  for (const ev of events) {
    if (ev.type !== 'rollback') continue;
    for (const prior of events) {
      if (prior === ev) break;
      if (isTurnScopedEvent(prior) && prior.turnId >= ev.throughTurnId) {
        rollbackHiddenTurnIds.add(prior.turnId);
      }
      if ((prior.type === 'summary' || prior.type === 'compact') && prior.endTurnId >= ev.throughTurnId) {
        rollbackHiddenOpUuids.add(prior.uuid);
      }
    }
  }

  return events.filter((ev) => {
    if (ev.type === 'rollback') return false;
    if ((ev.type === 'summary' || ev.type === 'compact') && rollbackHiddenOpUuids.has(ev.uuid)) {
      return false;
    }
    if (isTurnScopedEvent(ev) && rollbackHiddenTurnIds.has(ev.turnId)) return false;
    return true;
  });
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

export function sessionEventsToTurns(events: SessionEvent[]): UITurn[] {
  const turnsMap = new Map<number, UITurn>();
  const nextId = createTurnScopedIdGenerator();

  for (const event of events) {
    if (event.type === 'session_meta') continue;
    if (event.type === 'compact' || event.type === 'rollback') continue;
    if (event.type === 'subagent_result' || event.type === 'subagent_message') continue;

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
        if (event.source === 'system') break;
        turn.items.push({
          id: nextId('user', event.turnId),
          type: 'message',
          role: 'user',
          parts: event.content,
        });
        break;
      case 'assistant':
        if (event.reasoning?.displayText) {
          turn.items.push({
            id: nextId('reasoning', event.turnId),
            type: 'reasoning',
            content: event.reasoning.displayText,
            isVisible: true,
          });
        }
        if (event.content) {
          turn.items.push({
            id: nextId('assistant', event.turnId),
            type: 'message',
            role: 'assistant',
            parts: [textPart(event.content)],
          });
        }
        for (const tc of event.toolCalls ?? []) {
          turn.items.push({
            id: tc.id,
            type: 'tool_call',
            name: tc.name,
            arguments: tc.arguments ?? {},
            status: 'approved',
          });
        }
        break;
      case 'tool_result':
        turn.items.push({
          id: `result-${event.toolCallId}`,
          type: 'tool_result',
          callId: event.toolCallId,
          name: event.toolName,
          output: event.output,
        });
        break;
    }
  }
  return [...turnsMap.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
