import { describe, it, expect } from 'vitest';
import { assemblePayload, snipEvents, microcompact } from '../../src/context/organizer.js';
import type { SessionEvent, ToolResultEvent } from '../../src/session/types.js';

const baseConfig = {
  snipMaxMessages: 50,
  toolsExemptFromMicrocompact: ['Read'],
  keepRecentToolResults: 3,
} as any;

function makeUserEvent(content: string, turnId: number): SessionEvent {
  return { type: 'user', uuid: `u${turnId}`, content, turnId, timestamp: new Date().toISOString() };
}

function makeToolResult(toolName: string, output: string, turnId: number, uuid: string): ToolResultEvent {
  return { type: 'tool_result', uuid, parentUuid: 'a1', toolName, toolCallId: `tc${uuid}`, output, turnId, timestamp: new Date().toISOString(), tokenCount: 0 };
}

describe('snipEvents', () => {
  it('returns all events when under threshold', () => {
    const events: SessionEvent[] = Array.from({ length: 10 }, (_, i) => makeUserEvent(`msg${i}`, i));
    const result = snipEvents(events, baseConfig);
    expect(result.events).toHaveLength(10);
    expect(result.tokensFreed).toBe(0);
  });

  it('truncates head, keeping only tail snipMaxMessages', () => {
    const events: SessionEvent[] = Array.from({ length: 60 }, (_, i) => makeUserEvent(`msg${i}`, i));
    const result = snipEvents(events, baseConfig);
    expect(result.events).toHaveLength(51); // 1 summary + 50 events
    const summary0 = result.events[0];
    expect(summary0!.type).toBe('summary');
    expect((summary0 as any).summaryText).toContain('messages snipped');
    expect((result.events[1] as any).content).toBe('msg10');
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it('retreats to user boundary and inserts summary placeholder', () => {
    const events: SessionEvent[] = [
      makeUserEvent('q1', 1),
      { type: 'assistant', uuid: 'a1', content: 'a1', turnId: 1, toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
      makeToolResult('bash', 'r1', 1, 't1'),
      makeUserEvent('q2', 2),
      { type: 'assistant', uuid: 'a2', content: 'a2', turnId: 2, toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
      makeToolResult('bash', 'r2', 2, 't2'),
    ];
    const result = snipEvents(events, { ...baseConfig, snipMaxMessages: 4 });
    expect(result.events.length).toBe(4);
    const summary1 = result.events[0];
    expect(summary1!.type).toBe('summary');
    expect((summary1 as any).summaryText).toContain('messages snipped');
    expect((result.events[1] as any).content).toBe('q2');
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it('counts summary event tokens in tokensFreed', () => {
    const events: SessionEvent[] = [
      { type: 'summary', uuid: 's1', replaces: [], summaryText: 'A'.repeat(100), method: 'auto-compact', timestamp: new Date().toISOString() },
      makeUserEvent('q1', 1),
      { type: 'assistant', uuid: 'a1', content: 'a1', turnId: 1, toolCalls: [], model: 'test', timestamp: new Date().toISOString() },
    ];
    const result = snipEvents(events, { ...baseConfig, snipMaxMessages: 2 });
    expect(result.events.length).toBe(3);
    expect(result.tokensFreed).toBeGreaterThan(0);
  });
});

describe('microcompact', () => {
  it('keeps all when tool_result count <= keepRecentToolResults', () => {
    const events: SessionEvent[] = [
      makeToolResult('bash', 'a'.repeat(200), 1, 't1'),
      makeToolResult('bash', 'b'.repeat(200), 2, 't2'),
    ];
    const result = microcompact(events, baseConfig);
    expect((result[0] as ToolResultEvent).output).toBe('a'.repeat(200));
    expect((result[1] as ToolResultEvent).output).toBe('b'.repeat(200));
  });

  it('replaces old tool results with placeholder, keeps recent 3', () => {
    const longContent = 'x'.repeat(500); // ~143 tokens > 120
    const events: SessionEvent[] = [
      makeToolResult('bash', longContent, 1, 't1'),
      makeToolResult('bash', longContent, 2, 't2'),
      makeToolResult('bash', longContent, 3, 't3'),
      makeToolResult('bash', longContent, 4, 't4'),
      makeToolResult('bash', longContent, 5, 't5'),
    ];
    const result = microcompact(events, { ...baseConfig, keepRecentToolResults: 3 });
    expect((result[0] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[1] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[2] as ToolResultEvent).output).toBe(longContent);
    expect((result[3] as ToolResultEvent).output).toBe(longContent);
    expect((result[4] as ToolResultEvent).output).toBe(longContent);
  });

  it('skips exempt tools', () => {
    const longContent = 'x'.repeat(500); // ~143 tokens > 120
    const events: SessionEvent[] = [
      makeToolResult('Read', longContent, 1, 't1'),
      makeToolResult('bash', longContent, 1, 't2'),
      makeToolResult('bash', longContent, 2, 't3'),
    ];
    // keepRecentToolResults=1: only the most recent non-exempt tool is kept
    const result = microcompact(events, { ...baseConfig, keepRecentToolResults: 1 });
    expect((result[0] as ToolResultEvent).output).toBe(longContent); // Read exempt
    expect((result[1] as ToolResultEvent).output).toBe('[Old tool result content cleared]'); // t2 replaced
    expect((result[2] as ToolResultEvent).output).toBe(longContent); // t3 recent, kept
  });

  it('skips short content <= 120 chars', () => {
    const events: SessionEvent[] = [
      makeToolResult('bash', 'short', 1, 't1'),
      makeToolResult('bash', 'x'.repeat(200), 2, 't2'),
    ];
    const result = microcompact(events, { ...baseConfig, keepRecentToolResults: 1 });
    expect((result[0] as ToolResultEvent).output).toBe('short'); // <= 120, not replaced
    expect((result[1] as ToolResultEvent).output).toBe('x'.repeat(200)); // recent, kept
  });

  it('replaces tool results when token count exceeds 120 tokens', () => {
    const longContent = 'x'.repeat(500); // ~143 tokens > 120
    const events: SessionEvent[] = [
      makeToolResult('bash', longContent, 1, 't1'),
      makeToolResult('bash', longContent, 2, 't2'),
      makeToolResult('bash', longContent, 3, 't3'),
      makeToolResult('bash', longContent, 4, 't4'),
      makeToolResult('bash', longContent, 5, 't5'),
    ];
    const result = microcompact(events, { ...baseConfig, keepRecentToolResults: 3 });
    expect((result[0] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[1] as ToolResultEvent).output).toBe('[Old tool result content cleared]');
    expect((result[2] as ToolResultEvent).output).toBe(longContent);
    expect((result[3] as ToolResultEvent).output).toBe(longContent);
    expect((result[4] as ToolResultEvent).output).toBe(longContent);
  });
});

describe('assemblePayload', () => {
  it('is importable and exists as a function', () => {
    expect(typeof assemblePayload).toBe('function');
  });
});
