import { describe, it, expect } from 'vitest';
import { createStreamState, reduceFrame } from '../src/lib/frame-reducer';
import type { StreamEffects } from '../src/lib/frame-reducer';
import type { Frame, FrameBody, Envelope } from '@codingcode/core/core/frame';
import type { Item, TodoItem } from '../shared/types';

function frame(body: FrameBody, over: Partial<Envelope> = {}): Frame {
  return { sessionId: 's', turnId: 1, seq: 1, ...over, ...body } as Frame;
}

function makeFx() {
  const items: Item[] = [];
  const todos: TodoItem[][] = [];
  const usage: Array<{ prompt: number; completion: number; total: number }> = [];
  const compacted: boolean[] = [];
  const turnIds: number[] = [];
  let n = 0;
  const fx: StreamEffects = {
    applyItem: (i) => items.push(i),
    applyTodo: (t) => todos.push([...t]),
    setUsage: (u) => usage.push(u),
    setCompacted: () => compacted.push(true),
    syncTurnId: (id) => turnIds.push(id),
    newId: () => `gen-${++n}`,
  };
  return { fx, items, todos, usage, compacted, turnIds };
}

const textDelta = (text: string): FrameBody => ({
  family: 'event',
  event: { type: 'text_delta', text },
});
const responded = (u?: { prompt: number; completion: number; total: number }): FrameBody => ({
  family: 'transition',
  transition: { to: 'executing', responded: u ? { usage: u } : {} },
});
const compressFrame = (): FrameBody => ({
  family: 'transition',
  transition: { to: 'compress' },
});

describe('reduceFrame — envelope', () => {
  it('syncs turnId exactly once from the first stamped frame', () => {
    const { fx, turnIds } = makeFx();
    const state = createStreamState('m1');

    reduceFrame(frame(textDelta('a'), { turnId: 7 }), state, fx);
    reduceFrame(frame(textDelta('b'), { turnId: 7 }), state, fx);
    reduceFrame(frame(textDelta('c'), { turnId: 8 }), state, fx);

    expect(turnIds).toEqual([7]);
  });

  it('does not sync when turnId is null', () => {
    const { fx, turnIds } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(frame({ family: 'fatal', fatal: { message: 'x', code: 'Y' } }, { turnId: null }), state, fx);
    expect(turnIds).toEqual([]);
  });
});

describe('reduceFrame — content events', () => {
  it('appends text_delta to the same assistant message', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');

    reduceFrame(frame(textDelta('Hello')), state, fx);
    reduceFrame(frame(textDelta(' world')), state, fx);

    expect(items).toEqual([
      { id: 'm1', type: 'message', role: 'assistant', content: 'Hello', partial: true },
      { id: 'm1', type: 'message', role: 'assistant', content: ' world', partial: true },
    ]);
  });

  it('finalizes the current message on responded and rotates the id for the next round', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');

    reduceFrame(frame(textDelta('done')), state, fx);
    reduceFrame(frame(responded()), state, fx);
    reduceFrame(frame(textDelta('next')), state, fx);

    expect(items).toEqual([
      { id: 'm1', type: 'message', role: 'assistant', content: 'done', partial: true },
      { id: 'm1', type: 'message', role: 'assistant', content: '', partial: false },
      { id: 'gen-1', type: 'message', role: 'assistant', content: 'next', partial: true },
    ]);
  });

  it('does not emit a finalize item when the round produced no text', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(frame(responded()), state, fx);
    expect(items).toEqual([]);
  });

  it('maps tool_call to a running tool_call item', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(
      frame({ family: 'event', event: { type: 'tool_call', id: 'tc-1', name: 'bash', args: { command: 'ls' } } }),
      state,
      fx
    );
    expect(items).toEqual([
      { id: 'tc-1', type: 'tool_call', name: 'bash', args: { command: 'ls' }, status: 'running' },
    ]);
  });

  it('maps approval_request to a pending tool_call item', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(
      frame({ family: 'event', event: { type: 'approval_request', id: 'apr-1', tool: 'write_file', args: {} } }),
      state,
      fx
    );
    expect(items).toEqual([
      { id: 'apr-1', type: 'tool_call', name: 'write_file', args: {}, status: 'pending' },
    ]);
  });
});

describe('reduceFrame — tool results', () => {
  it('maps ok outcome to a tool_result with exitCode 0', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(
      frame({
        family: 'event',
        event: { type: 'tool_result', id: 'tc-1', name: 'bash', outcome: { status: 'ok', output: 'fine' } },
      }),
      state,
      fx
    );
    expect(items).toEqual([
      { id: 'gen-1', type: 'tool_result', callId: 'tc-1', name: 'bash', output: 'fine', exitCode: 0 },
    ]);
  });

  it('maps error outcome to exitCode 1', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(
      frame({
        family: 'event',
        event: { type: 'tool_result', id: 'tc-1', name: 'bash', outcome: { status: 'error', output: 'boom' } },
      }),
      state,
      fx
    );
    expect(items[0]).toMatchObject({ type: 'tool_result', output: 'boom', exitCode: 1 });
  });

  it('maps denied outcome to a rejected call plus a result carrying the reason', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(
      frame({
        family: 'event',
        event: {
          type: 'tool_result',
          id: 'apr-1',
          name: 'write_file',
          outcome: { status: 'denied', reason: 'not allowed' },
        },
      }),
      state,
      fx
    );
    expect(items).toEqual([
      { id: 'apr-1', type: 'tool_call', name: 'write_file', args: {}, status: 'rejected' },
      { id: 'gen-1', type: 'tool_result', callId: 'apr-1', name: 'write_file', output: 'not allowed', exitCode: 1 },
    ]);
  });

  it('forwards todos carried by a tool_result', () => {
    const { fx, todos } = makeFx();
    const state = createStreamState('m1');
    const list: TodoItem[] = [
      { step: 'a', status: 'completed' },
      { step: 'b', status: 'pending' },
    ];
    reduceFrame(
      frame({
        family: 'event',
        event: {
          type: 'tool_result',
          id: 'tc-1',
          name: 'todo_write',
          outcome: { status: 'ok', output: 'ok' },
          todos: list,
        },
      }),
      state,
      fx
    );
    expect(todos).toEqual([list]);
  });
});

describe('reduceFrame — submit_plan tracking', () => {
  const submitCall: FrameBody = {
    family: 'event',
    event: { type: 'tool_call', id: 'sp-1', name: 'submit_plan', args: { title: 'My Plan' } },
  };

  it('records the plan title from a successful submit_plan', () => {
    const { fx } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(frame(submitCall), state, fx);
    reduceFrame(
      frame({
        family: 'event',
        event: { type: 'tool_result', id: 'sp-1', name: 'submit_plan', outcome: { status: 'ok', output: 'ok' } },
      }),
      state,
      fx
    );
    expect(state.planTitle).toBe('My Plan');
  });

  it('clears the plan title when submit_plan fails', () => {
    const { fx } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(frame(submitCall), state, fx);
    reduceFrame(
      frame({
        family: 'event',
        event: { type: 'tool_result', id: 'sp-1', name: 'submit_plan', outcome: { status: 'error', output: 'nope' } },
      }),
      state,
      fx
    );
    expect(state.planTitle).toBeNull();
  });
});

describe('reduceFrame — transitions', () => {
  it('fires setUsage from responded.usage', () => {
    const { fx, usage } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(frame(responded({ prompt: 10, completion: 5, total: 15 })), state, fx);
    expect(usage).toEqual([{ prompt: 10, completion: 5, total: 15 }]);
  });

  it('fires setCompacted from the compress frame', () => {
    const { fx, compacted } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(frame(compressFrame()), state, fx);
    expect(compacted).toEqual([true]);
  });

  it('records end(error) as an error item and marks the stream failed', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(
      frame({
        family: 'transition',
        transition: { to: 'end', reason: 'error', error: { message: 'boom', code: 'LLM_FAILED' } },
      }),
      state,
      fx
    );
    expect(state.hasError).toBe(true);
    expect(items).toEqual([{ id: 'gen-1', type: 'error', message: 'boom', code: 'LLM_FAILED' }]);
  });

  it('records end(done) as a clean finish', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(frame({ family: 'transition', transition: { to: 'end', reason: 'done' } }), state, fx);
    expect(state.hasError).toBe(false);
    expect(items).toEqual([]);
  });

  it('records a fatal as an error item', () => {
    const { fx, items } = makeFx();
    const state = createStreamState('m1');
    reduceFrame(frame({ family: 'fatal', fatal: { message: 'transport', code: 'TRANSPORT' } }), state, fx);
    expect(state.hasError).toBe(true);
    expect(items).toEqual([{ id: 'gen-1', type: 'error', message: 'transport', code: 'TRANSPORT' }]);
  });
});
