import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { recordAgentEvents } from '../src/orchestration/record-agent-events.js';
import type { AgentEvent } from '../src/agent/agent.js';
import type { SessionStoreState } from '../src/session/store.js';

function makeMockContext() {
  const calls: Array<{ method: string; args: any[] }> = [];
  return {
    calls,
    ctx: {
      addAssistant: (...args: any[]) => {
        calls.push({ method: 'addAssistant', args });
        return Effect.succeed(undefined);
      },
      addToolResult: (...args: any[]) => {
        calls.push({ method: 'addToolResult', args });
        return Effect.succeed(undefined);
      },
    },
  };
}

function makeMockSession() {
  const calls: Array<{ method: string; args: any[] }> = [];
  let uuidCounter = 0;
  return {
    calls,
    session: {
      recordAssistant: (...args: any[]) => {
        calls.push({ method: 'recordAssistant', args });
        return Effect.succeed({ uuid: `a${++uuidCounter}` });
      },
      recordToolResult: (...args: any[]) => {
        calls.push({ method: 'recordToolResult', args });
        return Effect.succeed({ uuid: `t${++uuidCounter}` });
      },
    },
  };
}

const mockState: SessionStoreState = {
  sessionId: 'test-sid',
  cwd: '/tmp',
  projectSlug: 'test',
  transcriptPath: '/tmp/t.jsonl',
  indexPath: '/tmp/t.index.json',
  messageCount: 0,
  currentTurnId: 0,
  sessionMeta: { model: 'test-model', version: '0.1.0', createdAt: new Date().toISOString() } as any,
  title: 'test',
};

describe('recordAgentEvents', () => {
  it('passes through all events unchanged', async () => {
    const events: AgentEvent[] = [
      { _tag: 'LlmChunk', text: 'hello' },
      { _tag: 'Step', step: 1, max: 10 },
      { _tag: 'Assistant', content: 'response', toolCalls: [] },
      { _tag: 'Done', content: 'response' },
    ];

    async function* source() {
      for (const e of events) yield e;
    }

    const { ctx } = makeMockContext();
    const { session } = makeMockSession();

    const result: AgentEvent[] = [];
    for await (const event of recordAgentEvents(source(), ctx as any, session as any, mockState, 'test-sid')) {
      result.push(event);
    }

    expect(result).toEqual(events);
  });

  it('records Assistant to context and session', async () => {
    async function* source() {
      yield { _tag: 'Assistant', content: 'answer', toolCalls: [] } as AgentEvent;
    }

    const { ctx, calls: ctxCalls } = makeMockContext();
    const { session, calls: sessCalls } = makeMockSession();

    for await (const _ of recordAgentEvents(source(), ctx as any, session as any, mockState, 'test-sid')) {
      // consume
    }

    expect(ctxCalls).toHaveLength(1);
    expect(ctxCalls[0]!.method).toBe('addAssistant');
    expect(ctxCalls[0]!.args[0]).toBe('test-sid');
    expect(ctxCalls[0]!.args[1]).toBe('answer');

    expect(sessCalls).toHaveLength(1);
    expect(sessCalls[0]!.method).toBe('recordAssistant');
    expect(sessCalls[0]!.args[1]).toBe('answer');
    expect(sessCalls[0]!.args[3]).toBe('test-model');
  });

  it('records ToolResult to context and session', async () => {
    async function* source() {
      yield { _tag: 'Assistant', content: 'using tool', toolCalls: [{ id: 'tc1', name: 'readFile', arguments: { path: '/x' } }] } as AgentEvent;
      yield { _tag: 'ToolResult', id: 'tc1', name: 'readFile', output: 'file content', ok: true } as AgentEvent;
    }

    const { ctx, calls: ctxCalls } = makeMockContext();
    const { session, calls: sessCalls } = makeMockSession();

    for await (const _ of recordAgentEvents(source(), ctx as any, session as any, mockState, 'test-sid')) {
      // consume
    }

    expect(ctxCalls).toHaveLength(2);
    expect(ctxCalls[1]!.method).toBe('addToolResult');
    expect(ctxCalls[1]!.args[0]).toBe('test-sid');
    expect(ctxCalls[1]!.args[1]).toBe('tc1');
    expect(ctxCalls[1]!.args[2]).toBe('file content');

    expect(sessCalls).toHaveLength(2);
    expect(sessCalls[1]!.method).toBe('recordToolResult');
    // args: state, assistantUuid, toolName, toolCallId, output
    expect(sessCalls[1]!.args[2]).toBe('readFile');
    expect(sessCalls[1]!.args[3]).toBe('tc1');
    expect(sessCalls[1]!.args[4]).toBe('file content');
  });

  it('does not record non-Assistant/ToolResult events', async () => {
    async function* source() {
      yield { _tag: 'LlmChunk', text: 'hi' } as AgentEvent;
      yield { _tag: 'Step', step: 1, max: 10 } as AgentEvent;
      yield { _tag: 'ToolStart', name: 't', args: {} } as AgentEvent;
      yield { _tag: 'Done', content: 'done' } as AgentEvent;
    }

    const { ctx, calls: ctxCalls } = makeMockContext();
    const { session, calls: sessCalls } = makeMockSession();

    for await (const _ of recordAgentEvents(source(), ctx as any, session as any, mockState, 'test-sid')) {
      // consume
    }

    expect(ctxCalls).toHaveLength(0);
    expect(sessCalls).toHaveLength(0);
  });
});
