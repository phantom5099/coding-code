import { describe, it, expect } from 'vitest';
import type { SessionEvent, SummaryEvent, CompactEvent } from '../../src/session/types.js';

function filterForUI(events: SessionEvent[]): SessionEvent[] {
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

function createTurnScopedIdGenerator() {
  const counters = new Map<string, number>();
  return (prefix: string, turnId: number): string => {
    const key = `${prefix}:${turnId}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return `${prefix}-${turnId}-${next}`;
  };
}

function sessionEventsToTurns(
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

function makeBaseEvents(extra: SessionEvent[] = []): SessionEvent[] {
  const base: SessionEvent[] = [
    {
      type: 'session_meta',
      sessionId: 's1',
      projectPath: 'p',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
    },
    { type: 'user', turnId: 1, content: 'hello' },
    { type: 'assistant', turnId: 1, content: 'hi', toolCalls: [] },
    { type: 'user', turnId: 2, content: 'do stuff' },
    { type: 'assistant', turnId: 2, content: 'ok', toolCalls: [] },
    { type: 'user', turnId: 3, content: 'done' },
    { type: 'assistant', turnId: 3, content: 'great', toolCalls: [] },
  ];
  return [...base, ...extra];
}

describe('filterForUI', () => {
  it('keeps all turns when no rollback or summary', () => {
    const events = makeBaseEvents();
    const visible = filterForUI(events);
    const turnIds = visible.filter((e) => 'turnId' in e).map((e) => (e as any).turnId);
    expect(turnIds).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("hides rollback'd turns", () => {
    const events = makeBaseEvents([{ type: 'rollback', throughTurnId: 2, reason: 'test' }]);
    const visible = filterForUI(events);
    const turnIds = visible.filter((e) => 'turnId' in e).map((e) => (e as any).turnId);
    expect(turnIds).toEqual([1, 1]);
  });

  it('does NOT hide summary-covered turns (unlike filterForContext)', () => {
    const events = makeBaseEvents([
      {
        type: 'summary',
        uuid: 'sum1',
        startTurnId: 1,
        endTurnId: 2,
        summaryText: '[compacted]',
      },
    ]);
    const visible = filterForUI(events);
    const turnIds = visible.filter((e) => 'turnId' in e).map((e) => (e as any).turnId);
    // Turns 1 and 2 should still be visible in UI
    expect(turnIds).toContain(1);
    expect(turnIds).toContain(2);
    expect(turnIds).toContain(3);
  });

  it('keeps summary event visible in UI', () => {
    const events = makeBaseEvents([
      {
        type: 'summary',
        uuid: 'sum1',
        startTurnId: 1,
        endTurnId: 2,
        summaryText: '[compacted]',
      },
    ]);
    const visible = filterForUI(events);
    const summaries = visible.filter((e) => e.type === 'summary');
    expect(summaries).toHaveLength(1);
    expect((summaries[0] as any).summaryText).toBe('[compacted]');
  });

  it('hides summary that was rolled back', () => {
    const events = makeBaseEvents([
      {
        type: 'summary',
        uuid: 'sum1',
        startTurnId: 1,
        endTurnId: 2,
        summaryText: '[compacted]',
      },
      { type: 'rollback', throughTurnId: 1, reason: 'test' },
    ]);
    const visible = filterForUI(events);
    const summaries = visible.filter((e) => e.type === 'summary');
    expect(summaries).toHaveLength(0);
  });

  it('hides compact that was rolled back', () => {
    const events = makeBaseEvents([
      {
        type: 'compact',
        uuid: 'c1',
        startTurnId: 1,
        endTurnId: 2,
      },
      { type: 'rollback', throughTurnId: 1, reason: 'test' },
    ]);
    const visible = filterForUI(events);
    const compacts = visible.filter((e) => e.type === 'compact');
    expect(compacts).toHaveLength(0);
  });

  it('does NOT hide compact-covered turns (full output visible)', () => {
    const events = makeBaseEvents([
      {
        type: 'compact',
        uuid: 'c1',
        startTurnId: 1,
        endTurnId: 2,
      },
    ]);
    const visible = filterForUI(events);
    const turnIds = visible.filter((e) => 'turnId' in e).map((e) => (e as any).turnId);
    expect(turnIds).toContain(1);
    expect(turnIds).toContain(2);
  });
});

describe('sessionEventsToTurns with summary', () => {
  it('renders summary as an item in the endTurnId turn', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      { type: 'user', turnId: 1, content: 'hello' },
      { type: 'assistant', turnId: 1, content: 'hi', toolCalls: [] },
      { type: 'user', turnId: 2, content: 'more' },
      { type: 'assistant', turnId: 2, content: 'ok', toolCalls: [] },
      {
        type: 'summary',
        uuid: 'sum1',
        startTurnId: 1,
        endTurnId: 2,
        summaryText: '[compacted history]',
      },
    ];
    const turns = sessionEventsToTurns(events);
    expect(turns).toHaveLength(2);
    // Turn 2 should have the summary item
    const turn2 = turns.find((t) => t.id === '2');
    expect(turn2).toBeDefined();
    const summaryItem = turn2!.items.find((i: any) => (i as any).type === 'summary');
    expect(summaryItem).toBeDefined();
    expect((summaryItem as any).content).toBe('[compacted history]');
    expect((summaryItem as any).startTurnId).toBe(1);
    expect((summaryItem as any).endTurnId).toBe(2);
  });
});
