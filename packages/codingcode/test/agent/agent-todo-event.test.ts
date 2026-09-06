import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import type { AgentEvent } from '../../src/agent/types.js';
import { makeState, runAgentTurn, type HarnessMocks } from '../helpers/agent-harness.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    maxSteps: 5,
    maxStopContinuations: 2,
    context: {
      compactionModel: '',
    },
    memory: {
      enabled: false,
      model: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
    },
    server: { port: 8080 },
  }),
}));

function okResponse(content: string, toolCalls?: any[]) {
  return Promise.resolve({ ok: true, value: { content, toolCalls } });
}

function makeLlm(firstToolName: string) {
  let callCount = 0;
  const llm = {
    completeStream: vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return {
          stream: (async function* () {})(),
          response: okResponse('', [{ id: 'tc1', name: firstToolName, arguments: {} }]),
        };
      }
      return { stream: (async function* () {})(), response: okResponse('done') };
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

function makeExecutor(output: string) {
  return {
    executeBatch: (calls: any[]) =>
      Effect.succeed(
        calls.map((c: any) => ({
          type: 'ok' as const,
          id: c.id,
          name: c.name,
          output,
        }))
      ),
  } as any;
}

describe('TodoUpdate event', () => {
  it('should yield TodoUpdate when todo_write tool is called', async () => {
    const todo = new Map<string, Array<{ step: string; status: string }>>();
    todo.set('test-todo-sid', [
      { step: 'setup', status: 'pending' },
      { step: 'test', status: 'completed' },
    ]);
    const mocks: HarnessMocks = {
      llm: makeLlm('todo_write'),
      state: makeState({ sessionId: 'test-todo-sid', cwd: '/tmp' }),
      todo,
      executor: makeExecutor('pending=1 completed=1 in_progress=0'),
    };

    const { events } = await runAgentTurn(mocks, { sessionId: 'test-todo-sid', cwd: '/tmp' });

    const todoUpdates = events.filter(
      (e): e is Extract<AgentEvent, { _tag: 'TodoUpdate' }> => e._tag === 'TodoUpdate'
    );
    expect(todoUpdates).toHaveLength(1);
    expect(todoUpdates[0]!.items).toEqual([
      { step: 'setup', status: 'pending' },
      { step: 'test', status: 'completed' },
    ]);
  });

  it('should not yield TodoUpdate when non-todo tools are called', async () => {
    const todo = new Map<string, Array<{ step: string; status: string }>>();
    const mocks: HarnessMocks = {
      llm: makeLlm('read_file'),
      state: makeState({ sessionId: 'non-todo', cwd: '/tmp' }),
      todo,
      executor: makeExecutor('file content'),
    };

    const { events } = await runAgentTurn(mocks, { sessionId: 'non-todo', cwd: '/tmp' });

    const todoUpdates = events.filter((e: any) => e._tag === 'TodoUpdate');
    expect(todoUpdates).toHaveLength(0);
  });
});
