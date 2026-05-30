import { describe, it, expect } from 'vitest';
import { sessionEventsToTurns } from '../../src/session/store.js';
import type { SessionEvent } from '../../src/session/types.js';

describe('sessionEventsToTurns diff rebuild', () => {
  it('rebuilds diff for edit_file from tool_call args', () => {
    const events: SessionEvent[] = [
      { type: 'session_meta', sessionId: 's1', projectPath: 'p', cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'edit file', timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'editing',
        toolCalls: [
          {
            id: 'tc1',
            name: 'edit_file',
            arguments: { path: 'src/utils.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc' },
          },
        ],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 'tr1',
        parentUuid: 'a1',
        toolName: 'edit_file',
        toolCallId: 'tc1',
        output: 'File updated',
        timestamp: new Date().toISOString(),
        tokenCount: 5,
      },
    ];

    const turns = sessionEventsToTurns(events);
    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn.items).toHaveLength(4);

    const toolResult = turn.items[3] as any;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.name).toBe('edit_file');
    expect(toolResult.diff).toContain('diff --git a/src/utils.ts b/src/utils.ts');
    expect(toolResult.diff).toContain('--- a/src/utils.ts');
    expect(toolResult.diff).toContain('+++ b/src/utils.ts');
    expect(toolResult.diff).toContain('-b');
    expect(toolResult.diff).toContain('+B');
    expect(toolResult.insertions).toBe(1);
    expect(toolResult.deletions).toBe(1);
    expect(toolResult.filePath).toBe('src/utils.ts');
  });

  it('rebuilds diff for write_file from tool_call args (treated as new file)', () => {
    const events: SessionEvent[] = [
      { type: 'session_meta', sessionId: 's1', projectPath: 'p', cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'write file', timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'writing',
        toolCalls: [
          {
            id: 'tc1',
            name: 'write_file',
            arguments: { path: 'README.md', content: '# Title\n\nHello' },
          },
        ],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 'tr1',
        parentUuid: 'a1',
        toolName: 'write_file',
        toolCallId: 'tc1',
        output: 'File written',
        timestamp: new Date().toISOString(),
        tokenCount: 5,
      },
    ];

    const turns = sessionEventsToTurns(events);
    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn.items).toHaveLength(4);

    const toolResult = turn.items[3] as any;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.name).toBe('write_file');
    expect(toolResult.diff).toContain('diff --git a/README.md b/README.md');
    expect(toolResult.diff).toContain('new file mode 100644');
    expect(toolResult.diff).toContain('--- /dev/null');
    expect(toolResult.diff).toContain('+++ b/README.md');
    expect(toolResult.diff).toContain('+# Title');
    expect(toolResult.diff).toContain('+Hello');
    expect(toolResult.insertions).toBeGreaterThan(0);
    expect(toolResult.deletions).toBe(0);
    expect(toolResult.filePath).toBe('README.md');
  });

  it('skips diff for non-file tools', () => {
    const events: SessionEvent[] = [
      { type: 'session_meta', sessionId: 's1', projectPath: 'p', cwd: '/tmp', model: 'test', createdAt: new Date().toISOString(), version: '0.1.0' },
      { type: 'user', turnId: 1, uuid: 'u1', content: 'run command', timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        turnId: 1,
        uuid: 'a1',
        content: 'running',
        toolCalls: [
          {
            id: 'tc1',
            name: 'bash',
            arguments: { command: 'echo hi' },
          },
        ],
        model: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_result',
        turnId: 1,
        uuid: 'tr1',
        parentUuid: 'a1',
        toolName: 'bash',
        toolCallId: 'tc1',
        output: 'hi',
        timestamp: new Date().toISOString(),
        tokenCount: 5,
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
