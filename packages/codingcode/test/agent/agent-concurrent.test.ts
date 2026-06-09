import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { runReActLoop } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';

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
    Effect.sync(() => ({
      messages: [{ role: 'user' as const, content: 'run all tools' }],
      newBudgets: [],
    })),
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
  sessionId: 'test-sid',
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
  memorySnapshot: '',
};

function makeDeps(overrides?: Record<string, any>) {
  return {
    maxSteps: 25,
    maxStopContinuations: 2,
    executor: null as any,
    runtime: { listAgentProfiles: () => [] } as any,
    agentService: mockAgentService as any,
    ctx: mockCtx as any,
    session: mockSession as any,
    checkpoint: mockCheckpoint as any,
    hooks: {
      emit: () => Effect.succeed(undefined),
      emitDecision: () => Effect.succeed(null),
    } as any,
    ...overrides,
  };
}

describe('runReActLoop 锟?concurrent tool execution', () => {
  it('should execute multiple tool calls concurrently', async () => {
    const executionOrder: string[] = [];
    const resolveBarrier = new Promise<void>((r) => setTimeout(r, 100));

    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'tool_a', arguments: { delay: 50 } },
              { id: 'tc2', name: 'tool_b', arguments: { delay: 10 } },
              { id: 'tc3', name: 'tool_c', arguments: { delay: 30 } },
            ],
          })
        ),
      }),
    };

    const mockExecutor = {
      execute: (name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.gen(function* () {
          if (name === 'tool_a') {
            yield* Effect.promise(() => resolveBarrier);
          } else {
            const delay = name === 'tool_b' ? 10 : 30;
            yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, delay)));
          }
          executionOrder.push(name);
          return `result-${name}`;
        }),
      executeBatch: (toolCalls: any[], _sessionId?: string) =>
        (Effect.forEach as any)(
          toolCalls,
          (tc: any) =>
            mockExecutor.execute(tc.name, tc.arguments ?? {}).pipe(
              (Effect.matchEffect as any)({
                onSuccess: (output: any) =>
                  Effect.succeed({ type: 'ok' as const, id: tc.id, name: tc.name, output }),
                onFailure: (err: any) =>
                  Effect.succeed({
                    type: 'error' as const,
                    id: tc.id,
                    name: tc.name,
                    output: String(err),
                  }),
              }),
              (Effect.catchAllDefect as any)((defect: any) =>
                Effect.succeed({
                  type: 'error' as const,
                  id: tc.id,
                  name: tc.name,
                  output: String(defect),
                })
              )
            ),
          { concurrency: 'unbounded' }
        ),
    };

    const gen = runReActLoop(
      { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any },
      makeDeps({ maxSteps: 1, executor: mockExecutor as any })
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    expect(executionOrder).toHaveLength(3);
    expect(executionOrder.indexOf('tool_b')).toBeLessThan(executionOrder.indexOf('tool_a'));
    expect(executionOrder.indexOf('tool_c')).toBeLessThan(executionOrder.indexOf('tool_a'));

    const toolResults = events.filter((e: any) => e._tag === 'ToolResult');
    expect(toolResults).toHaveLength(3);
  });

  it('should isolate tool failures', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'good_tool', arguments: {} },
              { id: 'tc2', name: 'bad_tool', arguments: {} },
              { id: 'tc3', name: 'good_tool2', arguments: {} },
            ],
          })
        ),
      }),
    };

    const mockExecutor = {
      execute: (name: string, _args: Record<string, unknown>, _opts?: any) =>
        name === 'bad_tool'
          ? Effect.fail(new Error('Simulated failure') as any)
          : Effect.succeed(`result-${name}`),
      executeBatch: (toolCalls: any[], _sessionId?: string) =>
        (Effect.forEach as any)(
          toolCalls,
          (tc: any) =>
            mockExecutor.execute(tc.name, tc.arguments ?? {}).pipe(
              (Effect.matchEffect as any)({
                onSuccess: (output: any) =>
                  Effect.succeed({ type: 'ok' as const, id: tc.id, name: tc.name, output }),
                onFailure: (err: any) =>
                  Effect.succeed({
                    type: 'error' as const,
                    id: tc.id,
                    name: tc.name,
                    output: String(err),
                  }),
              }),
              (Effect.catchAllDefect as any)((defect: any) =>
                Effect.succeed({
                  type: 'error' as const,
                  id: tc.id,
                  name: tc.name,
                  output: String(defect),
                })
              )
            ),
          { concurrency: 'unbounded' }
        ),
    };

    const gen = runReActLoop(
      { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any },
      makeDeps({ maxSteps: 1, executor: mockExecutor as any })
    );

    const events: any[] = [];
    for await (const event of gen) {
      events.push(event);
    }

    const toolResults = events.filter((e: any) => e._tag === 'ToolResult');
    expect(toolResults).toHaveLength(3);
    expect(toolResults.find((r: any) => r.name === 'good_tool')?.ok).toBe(true);
    expect(toolResults.find((r: any) => r.name === 'good_tool2')?.ok).toBe(true);
    expect(toolResults.find((r: any) => r.name === 'bad_tool')?.ok).toBe(false);
  });
});
