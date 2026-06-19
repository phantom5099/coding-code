import { describe, it, expect } from 'vitest';
import type { SessionEvent } from '../../src/session/types.js';

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

describe('sessionEventsToTurns', () => {
  it('parses edit_file tool_result without diff (diff is computed on frontend)', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        content: 'edit file',
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'editing',
        toolCalls: [
          {
            id: 'tc1',
            name: 'edit_file',
            arguments: { path: 'src/utils.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc' },
          },
        ],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'edit_file',
        toolCallId: 'tc1',
        output: 'File updated',
      },
    ];

    const turns = sessionEventsToTurns(events);
    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn.items).toHaveLength(4);

    const toolResult = turn.items[3] as any;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.name).toBe('edit_file');
    expect(toolResult.diff).toBeUndefined();
    expect(toolResult.filePath).toBeUndefined();
    expect(toolResult.insertions).toBeUndefined();
    expect(toolResult.deletions).toBeUndefined();
  });

  it('parses write_file tool_result without diff', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        content: 'write file',
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'writing',
        toolCalls: [
          {
            id: 'tc1',
            name: 'write_file',
            arguments: { path: 'README.md', content: '# Title\n\nHello' },
          },
        ],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'write_file',
        toolCallId: 'tc1',
        output: 'File written',
      },
    ];

    const turns = sessionEventsToTurns(events);
    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn.items).toHaveLength(4);

    const toolResult = turn.items[3] as any;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.name).toBe('write_file');
    expect(toolResult.diff).toBeUndefined();
    expect(toolResult.filePath).toBeUndefined();
  });

  it('parses non-file tool_result without diff', () => {
    const events: SessionEvent[] = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectPath: 'p',
        cwd: '/tmp',
        createdAt: new Date().toISOString(),
      },
      {
        type: 'user',
        turnId: 1,
        content: 'run command',
      },
      {
        type: 'assistant',
        turnId: 1,
        content: 'running',
        toolCalls: [
          {
            id: 'tc1',
            name: 'bash',
            arguments: { command: 'echo hi' },
          },
        ],
      },
      {
        type: 'tool_result',
        turnId: 1,
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'hi',
      },
    ];

    const turns = sessionEventsToTurns(events);
    const turn = turns[0]!;
    expect(turn.items).toHaveLength(4);
    const toolResult = turn.items[3] as any;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.diff).toBeUndefined();
    expect(toolResult.filePath).toBeUndefined();
  });
});
