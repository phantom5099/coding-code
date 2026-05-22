import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { recordTurn } from '../src/orchestration/turn-recorder.js';
import type { AgentEvent } from '../src/agent/agent.js';
import type { SessionStoreState } from '../src/session/store.js';

function makeMockContext() {
  const calls: Array<{ method: string; args: any[] }> = [];
  return {
    calls,
    ctx: {
      appendTurnEnd: (...args: any[]) => {
        calls.push({ method: 'appendTurnEnd', args });
        return Effect.succeed({ didCompress: false, released: 0 });
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

function makeMockCheckpoint() {
  const calls: Array<{ method: string; args: any[] }> = [];
  return {
    calls,
    checkpoint: {
      snapshotFinal: (...args: any[]) => {
        calls.push({ method: 'snapshotFinal', args });
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
  tokenCountEstimate: 0,
};

describe('recordTurn', () => {
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
    const { checkpoint } = makeMockCheckpoint();

    const result: AgentEvent[] = [];
    for await (const event of recordTurn(source(), { session: session as any, ctx: ctx as any, checkpoint: checkpoint as any },
      { state: mockState, sid: 'test-sid', turnId: 1, projectPath: '/tmp', llm: null })) {
      result.push(event);
    }

    expect(result).toEqual(events);
  });

  it('records Assistant to session only', async () => {
    async function* source() {
      yield { _tag: 'Assistant', content: 'answer', toolCalls: [] } as AgentEvent;
    }

    const { ctx, calls: ctxCalls } = makeMockContext();
    const { session, calls: sessCalls } = makeMockSession();
    const { checkpoint } = makeMockCheckpoint();

    for await (const _ of recordTurn(source(), { session: session as any, ctx: ctx as any, checkpoint: checkpoint as any },
      { state: mockState, sid: 'test-sid', turnId: 1, projectPath: '/tmp', llm: null })) {
      // consume
    }

    expect(ctxCalls).toHaveLength(1);
    expect(ctxCalls[0]!.method).toBe('appendTurnEnd');

    expect(sessCalls).toHaveLength(1);
    expect(sessCalls[0]!.method).toBe('recordAssistant');
    expect(sessCalls[0]!.args[1]).toBe('answer');
    expect(sessCalls[0]!.args[3]).toBe('test-model');
  });

  it('records ToolResult to session only', async () => {
    async function* source() {
      yield { _tag: 'Assistant', content: 'using tool', toolCalls: [{ id: 'tc1', name: 'readFile', arguments: { path: '/x' } }] } as AgentEvent;
      yield { _tag: 'ToolResult', id: 'tc1', name: 'readFile', output: 'file content', ok: true } as AgentEvent;
    }

    const { ctx, calls: ctxCalls } = makeMockContext();
    const { session, calls: sessCalls } = makeMockSession();
    const { checkpoint } = makeMockCheckpoint();

    for await (const _ of recordTurn(source(), { session: session as any, ctx: ctx as any, checkpoint: checkpoint as any },
      { state: mockState, sid: 'test-sid', turnId: 1, projectPath: '/tmp', llm: null })) {
      // consume
    }

    expect(ctxCalls).toHaveLength(1);
    expect(ctxCalls[0]!.method).toBe('appendTurnEnd');

    expect(sessCalls).toHaveLength(2);
    expect(sessCalls[1]!.method).toBe('recordToolResult');
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
    const { checkpoint } = makeMockCheckpoint();

    for await (const _ of recordTurn(source(), { session: session as any, ctx: ctx as any, checkpoint: checkpoint as any },
      { state: mockState, sid: 'test-sid', turnId: 1, projectPath: '/tmp', llm: null })) {
      // consume
    }

    expect(ctxCalls).toHaveLength(1);
    expect(ctxCalls[0]!.method).toBe('appendTurnEnd');
    expect(sessCalls).toHaveLength(0);
  });

  it('calls snapshotFinal on stream completion', async () => {
    async function* source() {
      yield { _tag: 'Done', content: 'done' } as AgentEvent;
    }

    const { ctx } = makeMockContext();
    const { session } = makeMockSession();
    const { checkpoint, calls: checkpointCalls } = makeMockCheckpoint();

    for await (const _ of recordTurn(source(), { session: session as any, ctx: ctx as any, checkpoint: checkpoint as any },
      { state: mockState, sid: 'test-sid', turnId: 1, projectPath: '/tmp', llm: null })) {
      // consume
    }

    expect(checkpointCalls).toHaveLength(1);
    expect(checkpointCalls[0]!.method).toBe('snapshotFinal');
    expect(checkpointCalls[0]!.args[1]).toBe('test-sid');
    expect(checkpointCalls[0]!.args[2]).toBe(1);
  });

  it('calls finally even if stream errors', async () => {
    async function* source() {
      yield { _tag: 'LlmChunk', text: 'hi' } as AgentEvent;
      throw new Error('stream error');
    }

    const { ctx } = makeMockContext();
    const { session } = makeMockSession();
    const { checkpoint, calls: checkpointCalls } = makeMockCheckpoint();

    try {
      for await (const _ of recordTurn(source(), { session: session as any, ctx: ctx as any, checkpoint: checkpoint as any },
        { state: mockState, sid: 'test-sid', turnId: 1, projectPath: '/tmp', llm: null })) {
        // consume
      }
    } catch {
      // expected
    }

    expect(checkpointCalls).toHaveLength(1);
    expect(checkpointCalls[0]!.method).toBe('snapshotFinal');
  });
});
