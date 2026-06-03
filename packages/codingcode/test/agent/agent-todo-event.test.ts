import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';
import { sharedTodoStore } from '../../src/self/todo.js';

const mockToolRegistry = {
  describeAll: () => [],
  filter: () => [],
  get: () => null,
  register: () => Effect.succeed(undefined),
  allCore: () => [],
  allDeferred: () => [],
  getDef: () => undefined,
};

const mockToolSearch = {
  isLoaded: () => false,
  listLoaded: () => [],
  listUnloadedDeferred: () => [],
  search: () => [],
  reset: () => {},
};

const mockAgentService = {
  runStream: () => {
    throw new Error('not implemented');
  },
};

const mockCtx = {
  build: (_sessionId: string) =>
    Effect.sync(() => ({ messages: [{ role: 'user' as const, content: 'hi' }], newBudgets: [] })),
  appendTurnEnd: (_sessionId: string, _llm?: any, _config?: any) =>
    Effect.succeed({ didCompress: false, released: 0 }),
  compress: (_sessionId: string, _llm?: any, _config?: any) =>
    Effect.succeed({ didCompress: true, released: 1000 }),
  compactIfNeeded: () => Effect.succeed({ didCompress: false, released: 0 }),
};

const mockSession = {
  recordAssistant: (_state: any, _content: string, _toolCalls: any, _model: string) =>
    Effect.sync(() => ({ uuid: 'a1' })),
  recordToolResult: (
    _state: any,
    _parentUuid: string,
    _toolName: string,
    _toolCallId: string,
    _output: string
  ) => Effect.sync(() => ({})),
};

const mockCheckpoint = {
  snapshotFinal: () => {},
};

const mockState = {
  sessionId: 'test-todo-sid',
  cwd: '/tmp',
  projectPath: 'test',
  transcriptPath: '/tmp/test.jsonl',
  indexPath: '/tmp/test.index.json',
  messageCount: 0,
  currentTurnId: 1,
  sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
  title: 'test',
  usage: undefined,
  promptEstimate: 0,
};

const mockLlm = {
  completeStream: (_params: any) => ({
    stream: (async function* () {})(),
    response: Promise.resolve(
      Result.ok({
        content: '',
        toolCalls: [{ id: 'tc1', name: 'execute_command', arguments: { command: 'echo hi' } }],
      })
    ),
  }),
};

describe('TodoUpdate event', () => {
  it('should yield TodoUpdate when todo_write tool is called', async () => {
    sharedTodoStore.write('test-todo-sid', [
      { step: 'setup', status: 'pending' },
      { step: 'test', status: 'completed' },
    ]);

    const mockExecutor = {
      execute: () => Effect.succeed('done'),
      executeBatch: () =>
        Effect.succeed([
          {
            type: 'ok' as const,
            id: 'tc1',
            name: 'todo_write',
            output: 'pending=1 completed=1 in_progress=0',
          },
        ]),
    };

    const gen = runReActLoop(
      { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any },
      {
        maxSteps: 1,
        maxStopContinuations: 2,
        executor: mockExecutor as any,
        toolRegistry: mockToolRegistry as any,
        toolSearch: mockToolSearch as any,
        agentService: mockAgentService as any,
        ctx: mockCtx as any,
        session: mockSession as any,
        checkpoint: mockCheckpoint as any,
        hooks: {
          emit: () => Effect.succeed(undefined),
          emitDecision: () => Effect.succeed(null),
        } as any,
      }
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const todoUpdates = events.filter((e: any) => e._tag === 'TodoUpdate');
    expect(todoUpdates).toHaveLength(1);
    expect(todoUpdates[0].items).toEqual([
      { step: 'setup', status: 'pending' },
      { step: 'test', status: 'completed' },
    ]);
  });

  it('should not yield TodoUpdate when non-todo tools are called', async () => {
    sharedTodoStore.write('agent-non-todo', []);

    const mockExecutor = {
      execute: () => Effect.succeed('done'),
      executeBatch: () =>
        Effect.succeed([
          { type: 'ok' as const, id: 'tc1', name: 'read_file', output: 'file content' },
        ]),
    };

    const gen = runReActLoop(
      {
        state: { ...mockState, sessionId: 'non-todo' },
        llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      },
      {
        maxSteps: 1,
        maxStopContinuations: 2,
        executor: mockExecutor as any,
        toolRegistry: mockToolRegistry as any,
        toolSearch: mockToolSearch as any,
        agentService: mockAgentService as any,
        ctx: mockCtx as any,
        session: mockSession as any,
        checkpoint: mockCheckpoint as any,
        hooks: {
          emit: () => Effect.succeed(undefined),
          emitDecision: () => Effect.succeed(null),
        } as any,
      }
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const todoUpdates = events.filter((e: any) => e._tag === 'TodoUpdate');
    expect(todoUpdates).toHaveLength(0);
  });
});
