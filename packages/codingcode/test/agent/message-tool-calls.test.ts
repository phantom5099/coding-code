import { describe, it, expect } from 'vitest';
import type { Message } from '../../src/core/types.js';

describe('Message tool_calls assignment', () => {
  it('should allow direct assignment without as any cast', () => {
    const toolCalls = [{ id: 'tc1', name: 'read_file', arguments: { path: '/foo.ts' } }];
    const assistantMsg: Message = { role: 'assistant', content: 'Reading file' };

    // This must compile and work without `as any` because Message already
    // declares the optional `tool_calls` field.
    assistantMsg.tool_calls = toolCalls;

    expect(assistantMsg.tool_calls).toBe(toolCalls);
    expect(assistantMsg.tool_calls!).toHaveLength(1);
    expect(assistantMsg.tool_calls![0]!.name).toBe('read_file');
  });

  it('should keep tool_calls undefined when not assigned', () => {
    const assistantMsg: Message = { role: 'assistant', content: 'Hello' };
    expect(assistantMsg.tool_calls).toBeUndefined();
  });

  it('should round-trip through messages array', () => {
    const messages: Message[] = [];
    const assistantMsg: Message = { role: 'assistant', content: '' };
    assistantMsg.tool_calls = [
      { id: 'a', name: 'tool1', arguments: {} },
      { id: 'b', name: 'tool2', arguments: { x: 1 } },
    ];
    messages.push(assistantMsg);

    expect(messages[0]!.tool_calls!).toHaveLength(2);
    expect(messages[0]!.tool_calls![1]!.id).toBe('b');
  });
});
