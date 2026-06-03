import { describe, it, expect } from 'vitest';
import { agentEventToSseEvent, toSseEvents } from '../../src/server/adapter.js';
import type { AgentEvent } from '../../src/agent/agent.js';
import { AgentError } from '../../src/core/error.js';

describe('agentEventToSseEvent', () => {
  it('maps LlmChunk to null (handled by toSseEvents)', () => {
    expect(agentEventToSseEvent({ _tag: 'LlmChunk', text: 'hello' })).toBeNull();
  });

  it('maps Step to structured step event', () => {
    expect(agentEventToSseEvent({ _tag: 'Step', step: 3, max: 10 })).toEqual({
      type: 'step',
      step: 3,
    });
  });

  it('maps ToolStart to structured tool_start event', () => {
    expect(
      agentEventToSseEvent({ _tag: 'ToolStart', id: 'tc-1', name: 'readFile', args: {} })
    ).toEqual({ type: 'tool_start', id: 'tc-1', name: 'readFile', args: {} });
  });

  it('maps ToolDenied to tool_denied event', () => {
    expect(
      agentEventToSseEvent({ _tag: 'ToolDenied', id: 'tc-1', name: 'bash', reason: 'not allowed' })
    ).toEqual({ type: 'tool_denied', id: 'tc-1', name: 'bash', reason: 'not allowed' });
  });

  it('maps ApprovalRequest to approval_request event', () => {
    expect(
      agentEventToSseEvent({
        _tag: 'ApprovalRequest',
        id: 'abc',
        tool: 'write_file',
        args: { path: '/tmp/x' },
      })
    ).toEqual({
      type: 'approval_request',
      id: 'abc',
      tool: 'write_file',
      args: { path: '/tmp/x' },
    });
  });

  it('maps ToolResult to tool_result event', () => {
    expect(
      agentEventToSseEvent({ _tag: 'ToolResult', id: 'x', name: 't', output: 'ok', ok: true })
    ).toEqual({ type: 'tool_result', id: 'x', name: 't', output: 'ok', ok: true });
  });

  it('maps Error to error event', () => {
    const err = AgentError.llmFailed('test');
    expect(agentEventToSseEvent({ _tag: 'Error', error: err })).toEqual({
      type: 'error',
      message: err.message,
    });
  });

  it('maps Done to done event', () => {
    expect(agentEventToSseEvent({ _tag: 'Done', content: 'final' })).toEqual({ type: 'done' });
  });

  it('maps TodoUpdate to todo_update event', () => {
    const items = [{ step: 'test', status: 'completed' as const }];
    expect(agentEventToSseEvent({ _tag: 'TodoUpdate', items })).toEqual({
      type: 'todo_update',
      items,
    });
  });

  it('maps Usage to usage event', () => {
    expect(
      agentEventToSseEvent({ _tag: 'Usage', prompt: 1000, completion: 500, total: 1500 })
    ).toEqual({ type: 'usage', prompt: 1000, completion: 500, total: 1500 });
  });

  it('returns null for Assistant and ReactiveCompact', () => {
    expect(agentEventToSseEvent({ _tag: 'Assistant', content: 'ok' })).toBeNull();
    expect(
      agentEventToSseEvent({
        _tag: 'ReactiveCompact',
        attempt: 1,
        released: 100,
        promptEstimate: 0,
      })
    ).toBeNull();
  });
});

describe('toSseEvents with Usage', () => {
  it('Usage events flow through toSseEvents', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'Step', step: 1, max: 10 };
      yield { _tag: 'Assistant', content: 'ok' };
      yield { _tag: 'Usage', prompt: 1000, completion: 500, total: 1500 };
    }
    const result: any[] = [];
    for await (const s of toSseEvents(source())) result.push(s);
    expect(result).toEqual([
      { type: 'step', step: 1 },
      { type: 'message', id: 1, content: 'ok', partial: false },
      { type: 'usage', prompt: 1000, completion: 500, total: 1500 },
    ]);
  });
});

describe('toSseEvents', () => {
  it('text chunks carry messageId from preceding Step', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'Step', step: 1, max: 10 };
      yield { _tag: 'LlmChunk', text: 'Hello' };
      yield { _tag: 'LlmChunk', text: ' world' };
      yield { _tag: 'Done', content: 'final' };
    }
    const result: any[] = [];
    for await (const s of toSseEvents(source())) result.push(s);
    expect(result).toEqual([
      { type: 'step', step: 1 },
      { type: 'text', text: 'Hello', messageId: 1 },
      { type: 'text', text: ' world', messageId: 1 },
      { type: 'done' },
    ]);
  });

  it('step changes update messageId', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'Step', step: 1, max: 10 };
      yield { _tag: 'LlmChunk', text: 'a' };
      yield { _tag: 'Step', step: 2, max: 10 };
      yield { _tag: 'LlmChunk', text: 'b' };
    }
    const result: any[] = [];
    for await (const s of toSseEvents(source())) result.push(s);
    expect(result).toEqual([
      { type: 'step', step: 1 },
      { type: 'text', text: 'a', messageId: 1 },
      { type: 'step', step: 2 },
      { type: 'text', text: 'b', messageId: 2 },
    ]);
  });

  it('Assistant yields final message event with partial=false after chunk text', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'Step', step: 1, max: 10 };
      yield { _tag: 'LlmChunk', text: 'Hello' };
      yield { _tag: 'LlmChunk', text: ' world' };
      yield { _tag: 'Assistant', content: 'Hello world' };
      yield { _tag: 'Done', content: 'Hello world' };
    }
    const result: any[] = [];
    for await (const s of toSseEvents(source())) result.push(s);
    expect(result).toEqual([
      { type: 'step', step: 1 },
      { type: 'text', text: 'Hello', messageId: 1 },
      { type: 'text', text: ' world', messageId: 1 },
      { type: 'message', id: 1, content: 'Hello world', partial: false },
      { type: 'done' },
    ]);
  });

  it('Assistant with toolCalls yields message event with content only', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'Step', step: 2, max: 10 };
      yield { _tag: 'LlmChunk', text: 'calling tool' };
      yield {
        _tag: 'Assistant',
        content: 'calling tool',
        toolCalls: [{ id: 'tc-1', name: 'list_dir', arguments: {} }],
      };
    }
    const result: any[] = [];
    for await (const s of toSseEvents(source())) result.push(s);
    expect(result).toContainEqual({
      type: 'message',
      id: 2,
      content: 'calling tool',
      partial: false,
    });
  });

  it('text before first Step uses messageId 0', async () => {
    async function* source(): AsyncGenerator<AgentEvent, void, unknown> {
      yield { _tag: 'LlmChunk', text: 'early' };
      yield { _tag: 'Step', step: 1, max: 10 };
      yield { _tag: 'LlmChunk', text: 'late' };
    }
    const result: any[] = [];
    for await (const s of toSseEvents(source())) result.push(s);
    expect(result[0]).toEqual({ type: 'text', text: 'early', messageId: 0 });
    expect(result[2]).toEqual({ type: 'text', text: 'late', messageId: 1 });
  });
});
