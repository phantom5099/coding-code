import { describe, it, expect } from 'vitest';
import { assemblePayload, pruneToolResults, snipEvents } from '../../src/context/organizer.js';

const baseConfig = {
  prefixTurnsProtected: 1,
  pruneProtectedTokens: 100,
  pruneMinRelease: 1,
  toolsExemptFromPrune: ['Read'],
  snipMaxMessages: 50,
} as any;

describe('snipEvents', () => {
  it('returns all events when under threshold', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({ type: 'user', content: `msg${i}` }));
    const result = snipEvents(events, baseConfig);
    expect(result).toHaveLength(10);
  });

  it('truncates head, keeping only tail snipMaxMessages', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({ type: 'user', content: `msg${i}` }));
    const result = snipEvents(events, baseConfig);
    expect(result).toHaveLength(51); // 1 summary + 50 events
    expect(result[0].type).toBe('summary');
    expect(result[0].summaryText).toContain('messages snipped');
    expect(result[1].content).toBe('msg10');
    expect(result[50].content).toBe('msg59');
  });

  it('retreats to user boundary and inserts summary placeholder', () => {
    const events = [
      { type: 'user', content: 'q1', turnId: 1 },
      { type: 'assistant', content: 'a1', turnId: 1 },
      { type: 'tool_result', content: 'r1', turnId: 1 },
      { type: 'user', content: 'q2', turnId: 2 },
      { type: 'assistant', content: 'a2', turnId: 2 },
      { type: 'tool_result', content: 'r2', turnId: 2 },
    ];
    // snipMaxMessages=4: would slice from index 2 (tool_result r1),
    // but boundary retreats to index 3 (user q2)
    const result = snipEvents(events, { ...baseConfig, snipMaxMessages: 4 });
    expect(result.length).toBe(4);
    expect(result[0].type).toBe('summary');
    expect(result[0].summaryText).toContain('messages snipped');
    expect(result[1].content).toBe('q2');
    expect(result[3].content).toBe('r2');
  });
});

describe('pruneToolResults', () => {
  it('replaces old tool results with placeholder', () => {
    const events = [
      { type: 'user', content: 'hello', turnId: 1 },
      { type: 'assistant', content: 'hi', turnId: 1 },
      { type: 'tool_result', toolName: 'bash', output: 'x'.repeat(1000), turnId: 1, uuid: 't1', tokenCount: 250 },
      { type: 'user', content: 'step2', turnId: 2 },
      { type: 'assistant', content: 'ok', turnId: 2 },
      { type: 'tool_result', toolName: 'bash', output: 'y'.repeat(1000), turnId: 2, uuid: 't2', tokenCount: 250 },
    ];
    // currentTurnId=2, prefixTurnsProtected=1 → cutoff = 2-1-1=0, turnId<=0 are old
    // But all events have turnId >= 1, so nothing is pruned
    const result = pruneToolResults(events, 2, baseConfig);
    expect(result[2].output).toBe('x'.repeat(1000));
    expect(result[5].output).toBe('y'.repeat(1000));
  });

  it('skips exempt tools and recent turns', () => {
    const events = [
      { type: 'tool_result', toolName: 'Read', output: 'big read', turnId: 1, uuid: 't1', tokenCount: 50 },
      { type: 'tool_result', toolName: 'bash', output: 'big bash', turnId: 1, uuid: 't2', tokenCount: 50 },
    ];
    // currentTurnId=3, cutoff = 3-1-1 = 1. turnId <= 1 are prunable
    const result = pruneToolResults(events, 3, { ...baseConfig, pruneProtectedTokens: 0 });
    expect(result[0].output).toBe('big read'); // Read is exempt
    expect(result[1].output).toBe('[Old tool result content cleared]');
  });

  it('prunes old tool results when cutoff allows', () => {
    const events = [
      { type: 'user', content: 'q1', turnId: 1 },
      { type: 'tool_result', toolName: 'bash', output: 'x'.repeat(1000), turnId: 1, uuid: 't1', tokenCount: 250 },
      { type: 'user', content: 'q2', turnId: 2 },
      { type: 'tool_result', toolName: 'bash', output: 'y'.repeat(1000), turnId: 2, uuid: 't2', tokenCount: 250 },
      { type: 'user', content: 'q3', turnId: 3 },
      { type: 'tool_result', toolName: 'bash', output: 'z'.repeat(1000), turnId: 3, uuid: 't3', tokenCount: 250 },
    ];
    // currentTurnId=4, prefixTurnsProtected=1 -> cutoff = 2. turnId <= 2 are prunable
    // candidates sorted by turnId desc: [t2(turnId=2), t1(turnId=1)]
    // prune stops after reaching pruneMinRelease=1 on t2, so t1 is not pruned
    const result = pruneToolResults(events, 4, { ...baseConfig, pruneProtectedTokens: 0 });
    expect(result[1].output).toBe('x'.repeat(1000)); // t1 not pruned (release already met by t2)
    expect(result[3].output).toBe('[Old tool result content cleared]'); // t2 pruned first
    expect(result[5].output).toBe('z'.repeat(1000)); // t3 kept (turnId=3 > cutoff=2)
  });

  it('respects pruneProtectedTokens', () => {
    const events = [
      { type: 'tool_result', toolName: 'bash', output: 'big1', turnId: 1, uuid: 't1', tokenCount: 200 },
      { type: 'tool_result', toolName: 'bash', output: 'big2', turnId: 1, uuid: 't2', tokenCount: 200 },
      { type: 'tool_result', toolName: 'bash', output: 'big3', turnId: 1, uuid: 't3', tokenCount: 200 },
    ];
    // currentTurnId=3, cutoff=1. pruneProtectedTokens=300 -> first 300 tokens protected
    const result = pruneToolResults(events, 3, { ...baseConfig, pruneProtectedTokens: 300, pruneMinRelease: 1 });
    expect(result[0].output).toBe('big1'); // protected (200 tokens)
    expect(result[1].output).toBe('big2'); // protected (cumulative 400 >= 300, but already counted)
    expect(result[2].output).toBe('[Old tool result content cleared]'); // t3 pruned
  });
});

describe('assemblePayload', () => {
  it('is importable and exists as a function', () => {
    expect(typeof assemblePayload).toBe('function');
  });
});
