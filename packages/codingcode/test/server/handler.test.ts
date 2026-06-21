import { describe, it, expect } from 'vitest';
import { Layer, ManagedRuntime } from 'effect';
import { createSseHandler } from '../../src/server/handler.js';
import { toSseEvents } from '../../src/server/adapter.js';
import { ApprovalWaitService } from '../../src/approval/async-confirm.js';
import { PlanApprovalService } from '../../src/plan/approval-service.js';
import { AgentError } from '../../src/core/error.js';
import type { AgentEvent } from '../../src/agent/types.js';

const rt = ManagedRuntime.make(
  Layer.merge(ApprovalWaitService.Default, PlanApprovalService.Default as any) as any
);

async function readSSEStream(response: Response): Promise<{ events: any[] }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();

  const events: any[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(JSON.parse(line.slice(6)));
    }
  }
  return { events };
}

describe('sseHandler + toSseEvents', () => {
  it('should stream text chunks and complete event', async () => {
    const sseHandler = createSseHandler(rt);
    const handler = sseHandler(
      async function* () {
        yield* toSseEvents(
          (async function* (): AsyncGenerator<AgentEvent, void, unknown> {
            yield { _tag: 'TurnId', turnId: 0 };
            yield { _tag: 'Step', step: 1, max: 50 };
            yield { _tag: 'LlmChunk', text: 'Hello' };
            yield { _tag: 'LlmChunk', text: ' ' };
            yield { _tag: 'LlmChunk', text: 'world' };
            yield { _tag: 'Assistant', content: 'Hello world' };
            yield { _tag: 'Done', content: 'Hello world' };
          })()
        );
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    expect(events).toHaveLength(8);
    expect(events[0]).toEqual({ type: 'turn_id', turnId: 0 });
    expect(events[1]).toEqual({ type: 'step', step: 1 });
    expect(events[2]).toEqual({ type: 'text', text: 'Hello', messageId: 1 });
    expect(events[3]).toEqual({ type: 'text', text: ' ', messageId: 1 });
    expect(events[4]).toEqual({ type: 'text', text: 'world', messageId: 1 });
    expect(events[5]).toEqual({ type: 'message', id: 1, content: 'Hello world', partial: false });
    expect(events[6]).toEqual({ type: 'done' });
    expect(events[7]).toEqual({ type: 'complete' });
  });

  it('should send complete event even when LLM returns no text', async () => {
    const sseHandler = createSseHandler(rt);
    const handler = sseHandler(
      async function* () {
        yield* toSseEvents(
          (async function* (): AsyncGenerator<AgentEvent, void, unknown> {
            yield { _tag: 'TurnId', turnId: 0 };
            yield { _tag: 'Step', step: 1, max: 50 };
            yield { _tag: 'Assistant', content: '' };
            yield { _tag: 'Done', content: '' };
          })()
        );
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    expect(events[events.length - 1]).toEqual({ type: 'complete' });
  });

  it('should forward [Using: ...] markers when LLM calls tools', async () => {
    const sseHandler = createSseHandler(rt);
    const handler = sseHandler(
      async function* () {
        yield* toSseEvents(
          (async function* (): AsyncGenerator<AgentEvent, void, unknown> {
            yield { _tag: 'TurnId', turnId: 0 };
            yield { _tag: 'Step', step: 1, max: 50 };
            yield { _tag: 'LlmChunk', text: '\n[Using: readFile]\n' };
            yield { _tag: 'ToolStart', id: 'tc1', name: 'readFile', args: { path: 'test.txt' } };
            yield {
              _tag: 'ToolResult',
              id: 'tc1',
              name: 'readFile',
              output: 'file contents',
              ok: true,
            };
            yield { _tag: 'Done', content: '' };
          })()
        );
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    const textEvent = events.find((e: any) => e.type === 'text');
    expect(textEvent).toBeDefined();
    expect(textEvent!.text).toContain('[Using:');
  });

  it('should preserve AgentError code in catch', async () => {
    const sseHandler = createSseHandler(rt);
    const handler = sseHandler(
      async function* () {
        throw AgentError.toolNotFound('myTool');
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    const errorEvent = events.find((e: any) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.code).toBe('TOOL_NOT_FOUND');
    expect(errorEvent.message).toContain('myTool');
  });

  it('should not include code for plain Error in catch', async () => {
    const sseHandler = createSseHandler(rt);
    const handler = sseHandler(
      async function* () {
        throw new Error('plain error');
      },
      { sessionId: 'test' }
    );
    const response = await handler({} as any);
    const { events } = await readSSEStream(response);

    const errorEvent = events.find((e: any) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.code).toBeUndefined();
  });
});
