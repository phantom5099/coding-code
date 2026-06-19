import { describe, it, expect } from 'vitest';
import { historyToUIMessages } from '../src/utils.js';

describe('historyToUIMessages', () => {
  it('should return empty array for empty history', () => {
    expect(historyToUIMessages([])).toEqual([]);
  });

  it('should convert user events to UIMessage', () => {
    const history = [{ type: 'user', turnId: 1, content: 'hello' }];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'user-1-1',
      role: 'user',
      content: 'hello',
    });
    expect(typeof result[0].timestamp).toBe('number');
  });

  it('should convert assistant events to UIMessage', () => {
    const history = [{ type: 'assistant', turnId: 1, content: 'hi there' }];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'assistant-1-1',
      role: 'assistant',
      content: 'hi there',
    });
    expect(typeof result[0].timestamp).toBe('number');
  });

  it('should convert tool_result events to UIMessage with toolName', () => {
    const history = [
      {
        type: 'tool_result',
        toolCallId: 'tc1',
        output: 'result',
        toolName: 'read',
      },
    ];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'result-tc1',
      role: 'tool',
      content: 'result',
      toolName: 'read',
    });
    expect(typeof result[0].timestamp).toBe('number');
  });

  it('should skip session_meta, role_switch, and compact_boundary events', () => {
    const history = [
      {
        type: 'session_meta',
        sessionId: 's1',
        projectSlug: 'test',
        cwd: '/',
        model: 'm',
        role: 'coder',
        createdAt: '',
        version: '1',
      },
      { type: 'user', turnId: 1, content: 'hello' },
      { type: 'role_switch', fromRole: 'a', toRole: 'b' },
      { type: 'assistant', turnId: 2, content: 'hi' },
      {
        type: 'compact_boundary',
        summary: '...',
        replacedRange: [0, 1],
        messageCount: 1,
      },
    ];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  it('should handle conversation with interleaved tool calls', () => {
    const history = [
      { type: 'user', turnId: 1, content: 'read file' },
      {
        type: 'assistant',
        turnId: 2,
        content: 'let me read that',
        model: 'test-model',
        toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }],
      },
      {
        type: 'tool_result',
        content: undefined,
        output: 'file contents here',
        toolName: 'read',
        toolCallId: 'tc1',
      },
      {
        type: 'assistant',
        turnId: 3,
        content: 'the file contains...',
        model: 'test-model',
        toolCalls: [],
      },
    ];
    const result = historyToUIMessages(history);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('user');
    expect(result[0].id).toBe('user-1-1');
    expect(result[1].role).toBe('assistant');
    expect(result[1].id).toBe('assistant-2-1');
    expect(result[1].model).toBe('test-model');
    expect(result[2].role).toBe('tool');
    expect(result[2].id).toBe('result-tc1');
    expect(result[2].toolName).toBe('read');
    expect(result[2].content).toBe('file contents here');
    expect(result[3].role).toBe('assistant');
    expect(result[3].id).toBe('assistant-3-1');
  });

  it('should preserve message order from history', () => {
    const history = [
      { type: 'user', turnId: 1, content: 'msg1' },
      { type: 'user', turnId: 2, content: 'msg2' },
      { type: 'user', turnId: 3, content: 'msg3' },
    ];
    const result = historyToUIMessages(history);
    expect(result.map((m) => m.id)).toEqual(['user-1-1', 'user-2-1', 'user-3-1']);
  });

  it('should scope per-turn ids independently for same turn', () => {
    const history = [
      { type: 'user', turnId: 1, content: 'msg1' },
      { type: 'user', turnId: 1, content: 'msg2' },
      { type: 'assistant', turnId: 1, content: 'msg3' },
      { type: 'assistant', turnId: 1, content: 'msg4' },
    ];
    const result = historyToUIMessages(history);
    expect(result.map((m) => m.id)).toEqual([
      'user-1-1',
      'user-1-2',
      'assistant-1-1',
      'assistant-1-2',
    ]);
  });
});
