import { describe, it, expect } from 'vitest';
import type { SessionEvent } from '../../src/session/types.js';
import { sessionEventsToTurns } from '../../src/session/ui-history.js';

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
