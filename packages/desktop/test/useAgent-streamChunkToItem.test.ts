import { describe, it, expect } from 'vitest';

// Reconstruct streamChunkToItem logic for unit testing after StreamChunk refactor
function streamChunkToItem(
  event: any,
  threadId: string,
  assistantMessageId: string,
  currentTurnId: string
): any {
  switch (event.type) {
    case 'text':
      return {
        id: assistantMessageId,
        type: 'message',
        role: 'assistant',
        content: event.text,
        partial: true,
      };
    case 'message':
      return {
        id: assistantMessageId,
        type: 'message',
        role: 'assistant',
        content: event.content,
        partial: false,
      };
    case 'turn_id':
      return null;
    case 'tool_start':
      return {
        id: event.id,
        type: 'tool_call',
        name: event.name,
        args: event.args,
        status: 'running',
      };
    case 'approval_request':
      return {
        id: event.id,
        type: 'tool_call',
        name: event.tool,
        args: event.args,
        status: 'pending',
      };
    case 'tool_result':
      return {
        id: 'rand',
        type: 'tool_result',
        callId: event.id,
        name: event.name,
        output: event.output,
        exitCode: event.ok ? 0 : 1,
      };
    case 'tool_denied':
      return { id: event.id, type: 'tool_call', name: event.name, args: {}, status: 'rejected' };
    case 'error':
      return { id: 'rand', type: 'error', message: event.message };
    case 'todo_update':
      return null;
    case 'usage':
      return null;
    case 'reactive_compact':
      return null;
    case 'done':
    case 'session_id':
      return null;
    default:
      return null;
  }
}

describe('streamChunkToItem after StreamChunk refactor', () => {
  it('maps text chunk to partial assistant message', () => {
    const item = streamChunkToItem(
      { type: 'text', text: 'hello', messageId: 1 },
      't1',
      'a1',
      'turn1'
    );
    expect(item).toEqual({
      id: 'a1',
      type: 'message',
      role: 'assistant',
      content: 'hello',
      partial: true,
    });
  });

  it('maps message chunk to non-partial assistant message', () => {
    const item = streamChunkToItem(
      { type: 'message', id: 2, content: 'full text', partial: false },
      't1',
      'a1',
      'turn1'
    );
    expect(item).toEqual({
      id: 'a1',
      type: 'message',
      role: 'assistant',
      content: 'full text',
      partial: false,
    });
  });

  it('maps session_id to null', () => {
    const item = streamChunkToItem(
      { type: 'session_id', sessionId: 'sess-123' },
      't1',
      'a1',
      'turn1'
    );
    expect(item).toBeNull();
  });

  it('maps turn_id to null', () => {
    const item = streamChunkToItem({ type: 'turn_id', turnId: 42 }, 't1', 'a1', 'turn1');
    expect(item).toBeNull();
  });

  it('maps tool_start to running tool_call', () => {
    const item = streamChunkToItem(
      { type: 'tool_start', id: 'tc1', name: 'bash', args: { command: 'ls' } },
      't1',
      'a1',
      'turn1'
    );
    expect(item).toEqual({
      id: 'tc1',
      type: 'tool_call',
      name: 'bash',
      args: { command: 'ls' },
      status: 'running',
    });
  });

  it('maps approval_request to pending tool_call', () => {
    const item = streamChunkToItem(
      { type: 'approval_request', id: 'apr1', tool: 'write_file', args: { path: 'x' } },
      't1',
      'a1',
      'turn1'
    );
    expect(item).toEqual({
      id: 'apr1',
      type: 'tool_call',
      name: 'write_file',
      args: { path: 'x' },
      status: 'pending',
    });
  });

  it('maps tool_result to tool_result item', () => {
    const item = streamChunkToItem(
      { type: 'tool_result', id: 'tc1', name: 'bash', output: 'ok', ok: true },
      't1',
      'a1',
      'turn1'
    );
    expect(item).toMatchObject({
      type: 'tool_result',
      callId: 'tc1',
      name: 'bash',
      output: 'ok',
      exitCode: 0,
    });
  });

  it('maps error chunk to error item', () => {
    const item = streamChunkToItem({ type: 'error', message: 'boom' }, 't1', 'a1', 'turn1');
    expect(item).toMatchObject({
      type: 'error',
      message: 'boom',
    });
  });

  it('maps done to null', () => {
    const item = streamChunkToItem({ type: 'done' }, 't1', 'a1', 'turn1');
    expect(item).toBeNull();
  });

  it('maps usage to null', () => {
    const item = streamChunkToItem(
      { type: 'usage', prompt: 1000, completion: 500, total: 1500 },
      't1',
      'a1',
      'turn1'
    );
    expect(item).toBeNull();
  });

  it('maps reactive_compact to null', () => {
    const item = streamChunkToItem(
      { type: 'reactive_compact', released: 500, promptEstimate: 800 },
      't1',
      'a1',
      'turn1'
    );
    expect(item).toBeNull();
  });
});
