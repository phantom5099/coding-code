import { describe, it, expect } from 'vitest';
import { historyToUIMessages } from '../src/utils.js';

describe('historyToUIMessages', () => {
  it('should return empty array for empty history', () => {
    expect(historyToUIMessages([])).toEqual([]);
  });

  it('should convert user events to UIMessage', () => {
    const history = [
      { type: 'user', uuid: 'u1', content: 'hello', timestamp: '2025-01-01T00:00:00.000Z' },
    ];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'u1',
      role: 'user',
      content: 'hello',
    });
  });

  it('should convert assistant events to UIMessage', () => {
    const history = [
      { type: 'assistant', uuid: 'a1', content: 'hi there', timestamp: '2025-01-01T00:00:00.000Z' },
    ];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'a1',
      role: 'assistant',
      content: 'hi there',
    });
  });

  it('should convert tool_result events to UIMessage with toolName', () => {
    const history = [
      {
        type: 'tool_result',
        uuid: 't1',
        output: 'result',
        timestamp: '2025-01-01T00:00:00.000Z',
        toolName: 'read',
      },
    ];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 't1',
      role: 'tool',
      content: 'result',
      toolName: 'read',
    });
  });

  it('should skip session_meta, role_switch, and compact_boundary events', () => {
    const history = [
      {
        type: 'session_meta',
        uuid: 'm1',
        sessionId: 's1',
        projectSlug: 'test',
        cwd: '/',
        model: 'm',
        role: 'coder',
        createdAt: '',
        version: '1',
      },
      { type: 'user', uuid: 'u1', content: 'hello', timestamp: '2025-01-01T00:00:00.000Z' },
      { type: 'role_switch', uuid: 'r1', fromRole: 'a', toRole: 'b', timestamp: '' },
      { type: 'assistant', uuid: 'a1', content: 'hi', timestamp: '2025-01-01T00:00:00.000Z' },
      {
        type: 'compact_boundary',
        uuid: 'c1',
        summary: '...',
        replacedRange: [0, 1],
        messageCount: 1,
        timestamp: '',
      },
    ];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  it('should handle conversation with interleaved tool calls', () => {
    const history = [
      { type: 'user', uuid: 'u1', content: 'read file', timestamp: '2025-01-01T00:00:01.000Z' },
      {
        type: 'assistant',
        uuid: 'a1',
        content: 'let me read that',
        timestamp: '2025-01-01T00:00:02.000Z',
        model: 'test-model',
        toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }],
      },
      {
        type: 'tool_result',
        uuid: 't1',
        content: undefined,
        output: 'file contents here',
        timestamp: '2025-01-01T00:00:03.000Z',
        toolName: 'read',
        parentUuid: 'a1',
        toolCallId: 'tc1',
      },
      {
        type: 'assistant',
        uuid: 'a2',
        content: 'the file contains...',
        timestamp: '2025-01-01T00:00:04.000Z',
        model: 'test-model',
        toolCalls: [],
      },
    ];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[1].model).toBe('test-model');
    expect(result[2].role).toBe('tool');
    expect(result[2].toolName).toBe('read');
    expect(result[2].content).toBe('file contents here');
    expect(result[3].role).toBe('assistant');
  });

  it('should preserve message order from history', () => {
    const history = [
      { type: 'user', uuid: 'u1', content: 'msg1', timestamp: '2025-01-01T00:00:01.000Z' },
      { type: 'user', uuid: 'u2', content: 'msg2', timestamp: '2025-01-01T00:00:02.000Z' },
      { type: 'user', uuid: 'u3', content: 'msg3', timestamp: '2025-01-01T00:00:03.000Z' },
    ];
    const result = historyToUIMessages(history);
    expect(result.map((m) => m.id)).toEqual(['u1', 'u2', 'u3']);
  });
});
