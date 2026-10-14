import { describe, it, expect, vi } from 'vitest';
import { Effect } from 'effect';
import {
  makeState,
  runAgentTurn,
  llmStream,
  pText,
  pToolCall,
  pEnd,
  todoResults,
  type HarnessMocks,
} from '../helpers/agent-harness.js';

vi.mock('../../src/infra/config.js', () => ({
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
  }),
}));

const PLAN_A = [
  { step: 'setup', status: 'pending' },
  { step: 'test', status: 'completed' },
];

const PLAN_B = [{ step: 'ship', status: 'in_progress' }];

function makeLlm(toolName: string, args: Record<string, unknown>) {
  let callCount = 0;
  const llm = {
    completeStream: vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return llmStream(pToolCall('tc1', toolName, args), pEnd());
      }
      return llmStream(pText('done'), pEnd());
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

/** 单轮内并发两个 todo_write：帧各带当次调用的 plan，互不串台。 */
function makeLlmTwoTodoWrites() {
  let callCount = 0;
  const llm = {
    completeStream: vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return llmStream(
          pToolCall('tc1', 'todo_write', { plan: PLAN_A }),
          pToolCall('tc2', 'todo_write', { plan: PLAN_B }),
          pEnd()
        );
      }
      return llmStream(pText('done'), pEnd());
    }),
    modelInfo: { maxTokens: 1000 },
  } as any;
  return llm;
}

function makeExecutor(output: string) {
  return {
    prepare: () => Effect.succeed({ tools: [], lookup: () => undefined }),
    executeBatch: (calls: any[]) =>
      Effect.succeed(
        calls.map((c: any) => ({
          status: 'ok' as const,
          id: c.id,
          name: c.name,
          output,
        }))
      ),
  } as any;
}

describe('todo_write tool result', () => {
  it('should carry todos on the tool_result when todo_write is called', async () => {
    const mocks: HarnessMocks = {
      llm: makeLlm('todo_write', { plan: PLAN_A }),
      state: makeState({ sessionId: 'test-todo-sid', cwd: '/tmp' }),
      executor: makeExecutor('pending=1 completed=1 in_progress=0'),
    };

    const { events } = await runAgentTurn(mocks, { sessionId: 'test-todo-sid', cwd: '/tmp' });

    const results = todoResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.todos).toEqual(PLAN_A);
  });

  it('should not carry todos when non-todo tools are called', async () => {
    const mocks: HarnessMocks = {
      llm: makeLlm('read_file', {}),
      state: makeState({ sessionId: 'non-todo', cwd: '/tmp' }),
      executor: makeExecutor('file content'),
    };

    const { events } = await runAgentTurn(mocks, { sessionId: 'non-todo', cwd: '/tmp' });

    expect(todoResults(events)).toHaveLength(0);
  });

  it('should attach each call own plan when a batch contains two todo_write calls', async () => {
    const mocks: HarnessMocks = {
      llm: makeLlmTwoTodoWrites(),
      state: makeState({ sessionId: 'test-todo-sid', cwd: '/tmp' }),
      executor: makeExecutor('ok'),
    };

    const { events } = await runAgentTurn(mocks, { sessionId: 'test-todo-sid', cwd: '/tmp' });

    const results = todoResults(events);
    expect(results).toHaveLength(2);
    expect(results[0]!.todos).toEqual(PLAN_A);
    expect(results[1]!.todos).toEqual(PLAN_B);
  });
});
