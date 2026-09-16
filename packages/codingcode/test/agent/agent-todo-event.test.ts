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

function makeLlm(firstToolName: string) {
  let callCount = 0;
  const llm = {
    completeStream: vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return llmStream(pToolCall('tc1', firstToolName, {}), pEnd());
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

    const results = todoResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]!.todos).toEqual([
      { step: 'setup', status: 'pending' },
      { step: 'test', status: 'completed' },
    ]);
  });

  it('should not carry todos when non-todo tools are called', async () => {
    const todo = new Map<string, Array<{ step: string; status: string }>>();
    const mocks: HarnessMocks = {
      llm: makeLlm('read_file'),
      state: makeState({ sessionId: 'non-todo', cwd: '/tmp' }),
      todo,
      executor: makeExecutor('file content'),
    };

    const { events } = await runAgentTurn(mocks, { sessionId: 'non-todo', cwd: '/tmp' });

    expect(todoResults(events)).toHaveLength(0);
  });
});
