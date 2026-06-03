import { describe, it, expect } from 'vitest';
import { assemblePayload, pruneByTokens } from '../../src/context/organizer.js';
import type { SessionEvent, ToolResultEvent } from '../../src/session/types.js';

const baseConfig = {
  tokenPruneThreshold: 0.8,
  tokenPruneTurns: 2,
  minTurnsBeforePrune: 5,
  tokenPruneMinReleaseRatio: 0.5,
  tokenPruneMaxExtraTurns: 2,
} as any;

function makeUserEvent(content: string, turnId: number): SessionEvent {
  return { type: 'user', uuid: `u${turnId}`, content, turnId, timestamp: new Date().toISOString() };
}

function makeAssistant(content: string, turnId: number): SessionEvent {
  return {
    type: 'assistant',
    uuid: `a${turnId}`,
    content,
    turnId,
    toolCalls: [],
    model: 'test',
    timestamp: new Date().toISOString(),
  };
}

function makeToolResult(
  toolName: string,
  output: string,
  turnId: number,
  uuid: string
): ToolResultEvent {
  return {
    type: 'tool_result',
    uuid,
    parentUuid: 'a1',
    toolName,
    toolCallId: `tc${uuid}`,
    output,
    turnId,
    timestamp: new Date().toISOString(),
    tokenCount: 0,
  };
}

describe('pruneByTokens', () => {
  it('returns all events when token count is under threshold', () => {
    const events: SessionEvent[] = [makeUserEvent('q1', 1), makeAssistant('a1', 1)];
    const result = pruneByTokens(events, baseConfig, 100000);
    expect(result).toHaveLength(2);
    expect((result[0] as any).content).toBe('q1');
    expect((result[1] as any).content).toBe('a1');
  });

  it('returns all events when total turns <= minTurnsBeforePrune', () => {
    const longOutput = 'x'.repeat(5000);
    const events: SessionEvent[] = [
      makeUserEvent('q1', 1),
      makeAssistant('a1', 1),
      makeToolResult('bash', longOutput, 1, 't1'),
      makeUserEvent('q2', 2),
      makeAssistant('a2', 2),
      makeToolResult('bash', longOutput, 2, 't2'),
      makeUserEvent('q3', 3),
      makeAssistant('a3', 3),
      makeToolResult('bash', longOutput, 3, 't3'),
      makeUserEvent('q4', 4),
      makeAssistant('a4', 4),
      makeToolResult('bash', longOutput, 4, 't4'),
    ];
    const result = pruneByTokens(events, baseConfig, 100);
    expect(result).toHaveLength(events.length);
    // All tool results should be intact because turns <= 5
    expect((result[2] as ToolResultEvent).output).toBe(longOutput);
  });

  it('clears oldest turn when token count exceeds threshold (maxPrunable=1 for 6 turns)', () => {
    const longOutput = 'x'.repeat(5000);
    const events: SessionEvent[] = [
      makeUserEvent('q1', 1),
      makeAssistant('a1', 1),
      makeToolResult('bash', longOutput, 1, 't1'),
      makeUserEvent('q2', 2),
      makeAssistant('a2', 2),
      makeToolResult('bash', longOutput, 2, 't2'),
      makeUserEvent('q3', 3),
      makeAssistant('a3', 3),
      makeToolResult('bash', longOutput, 3, 't3'),
      makeUserEvent('q4', 4),
      makeAssistant('a4', 4),
      makeToolResult('bash', longOutput, 4, 't4'),
      makeUserEvent('q5', 5),
      makeAssistant('a5', 5),
      makeToolResult('bash', longOutput, 5, 't5'),
      makeUserEvent('q6', 6),
      makeAssistant('a6', 6),
      makeToolResult('bash', longOutput, 6, 't6'),
    ];
    const result = pruneByTokens(events, baseConfig, 100);
    // 6 turns => maxPrunable = 1, only turn 1 can be pruned
    expect((result[2] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    // Turns 2-6 should be intact
    expect((result[5] as ToolResultEvent).output).toBe(longOutput);
    expect((result[8] as ToolResultEvent).output).toBe(longOutput);
    expect((result[11] as ToolResultEvent).output).toBe(longOutput);
    expect((result[14] as ToolResultEvent).output).toBe(longOutput);
    expect((result[17] as ToolResultEvent).output).toBe(longOutput);
    // User and assistant messages should never be touched
    expect((result[0] as any).content).toBe('q1');
    expect((result[1] as any).content).toBe('a1');
  });

  it('prunes only base turns when release ratio is sufficient', () => {
    // Turn 1,2 have large tool results; turns 3-8 have small ones
    const largeOutput = 'x'.repeat(10000);
    const smallOutput = 'x'.repeat(100);
    const events: SessionEvent[] = [
      makeUserEvent('q1', 1),
      makeAssistant('a1', 1),
      makeToolResult('bash', largeOutput, 1, 't1'),
      makeUserEvent('q2', 2),
      makeAssistant('a2', 2),
      makeToolResult('bash', largeOutput, 2, 't2'),
      makeUserEvent('q3', 3),
      makeAssistant('a3', 3),
      makeToolResult('bash', smallOutput, 3, 't3'),
      makeUserEvent('q4', 4),
      makeAssistant('a4', 4),
      makeToolResult('bash', smallOutput, 4, 't4'),
      makeUserEvent('q5', 5),
      makeAssistant('a5', 5),
      makeToolResult('bash', smallOutput, 5, 't5'),
      makeUserEvent('q6', 6),
      makeAssistant('a6', 6),
      makeToolResult('bash', smallOutput, 6, 't6'),
      makeUserEvent('q7', 7),
      makeAssistant('a7', 7),
      makeToolResult('bash', smallOutput, 7, 't7'),
      makeUserEvent('q8', 8),
      makeAssistant('a8', 8),
      makeToolResult('bash', smallOutput, 8, 't8'),
    ];
    const result = pruneByTokens(events, baseConfig, 5000);
    // Oldest 2 turns release enough tokens (>> 50% of excess), stop at base turns
    expect((result[2] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[5] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    // Turns 3-8 should be intact
    expect((result[8] as ToolResultEvent).output).toBe(smallOutput);
    expect((result[11] as ToolResultEvent).output).toBe(smallOutput);
  });

  it('adds extra turns when base release ratio is insufficient', () => {
    // Turn 1,2 have small tool results; turn 3,4 have large ones
    const smallOutput = 'x'.repeat(100);
    const largeOutput = 'x'.repeat(10000);
    const events: SessionEvent[] = [
      makeUserEvent('q1', 1),
      makeAssistant('a1', 1),
      makeToolResult('bash', smallOutput, 1, 't1'),
      makeUserEvent('q2', 2),
      makeAssistant('a2', 2),
      makeToolResult('bash', smallOutput, 2, 't2'),
      makeUserEvent('q3', 3),
      makeAssistant('a3', 3),
      makeToolResult('bash', largeOutput, 3, 't3'),
      makeUserEvent('q4', 4),
      makeAssistant('a4', 4),
      makeToolResult('bash', largeOutput, 4, 't4'),
      makeUserEvent('q5', 5),
      makeAssistant('a5', 5),
      makeToolResult('bash', largeOutput, 5, 't5'),
      makeUserEvent('q6', 6),
      makeAssistant('a6', 6),
      makeToolResult('bash', largeOutput, 6, 't6'),
      makeUserEvent('q7', 7),
      makeAssistant('a7', 7),
      makeToolResult('bash', largeOutput, 7, 't7'),
      makeUserEvent('q8', 8),
      makeAssistant('a8', 8),
      makeToolResult('bash', largeOutput, 8, 't8'),
      makeUserEvent('q9', 9),
      makeAssistant('a9', 9),
      makeToolResult('bash', largeOutput, 9, 't9'),
    ];
    const result = pruneByTokens(events, baseConfig, 8000);
    // Base 2 turns release < 50% of excess; adding turns 3,4 pushes ratio above threshold
    expect((result[2] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[5] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[8] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[11] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    // Turns 5-9 should be intact
    expect((result[14] as ToolResultEvent).output).toBe(largeOutput);
    expect((result[17] as ToolResultEvent).output).toBe(largeOutput);
  });

  it('prunes up to hard limit when ratio never meets threshold', () => {
    // All tool results are small; even pruning all allowed turns won't meet ratio
    const tinyOutput = 'x'.repeat(100);
    const events: SessionEvent[] = [
      makeUserEvent('q1', 1),
      makeAssistant('a1', 1),
      makeToolResult('bash', tinyOutput, 1, 't1'),
      makeUserEvent('q2', 2),
      makeAssistant('a2', 2),
      makeToolResult('bash', tinyOutput, 2, 't2'),
      makeUserEvent('q3', 3),
      makeAssistant('a3', 3),
      makeToolResult('bash', tinyOutput, 3, 't3'),
      makeUserEvent('q4', 4),
      makeAssistant('a4', 4),
      makeToolResult('bash', tinyOutput, 4, 't4'),
      makeUserEvent('q5', 5),
      makeAssistant('a5', 5),
      makeToolResult('bash', tinyOutput, 5, 't5'),
      makeUserEvent('q6', 6),
      makeAssistant('a6', 6),
      makeToolResult('bash', tinyOutput, 6, 't6'),
      makeUserEvent('q7', 7),
      makeAssistant('a7', 7),
      makeToolResult('bash', tinyOutput, 7, 't7'),
      makeUserEvent('q8', 8),
      makeAssistant('a8', 8),
      makeToolResult('bash', tinyOutput, 8, 't8'),
    ];
    const result = pruneByTokens(events, baseConfig, 100);
    // 8 turns => maxPrunable = 3, hardLimit = 4 => pruneable = 3 turns
    // All pruned because ratio never meets threshold but we execute up to limit
    expect((result[2] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[5] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[8] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    // Turns 4-8 should be intact
    expect((result[11] as ToolResultEvent).output).toBe(tinyOutput);
    expect((result[14] as ToolResultEvent).output).toBe(tinyOutput);
  });

  it('does not prune summary or hide events', () => {
    const longOutput = 'x'.repeat(5000);
    const events: SessionEvent[] = [
      {
        type: 'summary',
        uuid: 's1',
        replaces: [],
        summaryText: 'Summary text',
        method: 'auto-compact',
        timestamp: new Date().toISOString(),
      },
      makeUserEvent('q1', 1),
      makeAssistant('a1', 1),
      makeToolResult('bash', longOutput, 1, 't1'),
      makeUserEvent('q2', 2),
      makeAssistant('a2', 2),
      makeToolResult('bash', longOutput, 2, 't2'),
      makeUserEvent('q3', 3),
      makeAssistant('a3', 3),
      makeToolResult('bash', longOutput, 3, 't3'),
      makeUserEvent('q4', 4),
      makeAssistant('a4', 4),
      makeToolResult('bash', longOutput, 4, 't4'),
      makeUserEvent('q5', 5),
      makeAssistant('a5', 5),
      makeToolResult('bash', longOutput, 5, 't5'),
      makeUserEvent('q6', 6),
      makeAssistant('a6', 6),
      makeToolResult('bash', longOutput, 6, 't6'),
    ];
    const result = pruneByTokens(events, baseConfig, 100);
    // Summary should remain
    expect(result[0]!.type).toBe('summary');
    expect((result[0] as any).summaryText).toBe('Summary text');
    // Oldest tool results cleared
    expect((result[3] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    // Recent tool results intact
    expect((result[18] as ToolResultEvent).output).toBe(longOutput);
  });
});

describe('assemblePayload', () => {
  it('is importable and exists as a function', () => {
    expect(typeof assemblePayload).toBe('function');
  });
});
