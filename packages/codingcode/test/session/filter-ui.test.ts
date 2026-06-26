import { describe, it, expect } from 'vitest';
import type { SessionEvent } from '../../src/session/types.js';
import { filterForUI, sessionEventsToTurns } from '../../src/session/ui-history.js';

function makeBaseEvents(extra: SessionEvent[] = []): SessionEvent[] {
  const base: SessionEvent[] = [
    {
      type: 'session_meta',
      sessionId: 's1',
      projectPath: 'p',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
      mode: 'build',
      permissionMode: 'default',
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
        mode: 'build',
        permissionMode: 'default',
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
