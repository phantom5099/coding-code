import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, Queue, Chunk } from 'effect';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
import { SessionService } from '../../src/session/store.js';
import { agentLoop } from '../../src/agent/agent.js';
import type { AgentEvent } from '../../src/agent/types.js';
import { Result } from '../../src/core/result.js';
import { HookService } from '../../src/hooks/registry.js';
import { ToolExecutorService } from '../../src/tools/executor.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { TodoService } from '../../src/agent/todo.js';
import { ContextService } from '../../src/context/service.js';
import { MemoryService } from '../../src/memory/index.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    context: {
      compactionModel: '',
    },
    memory: {
      enabled: false,
      model: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
      extraTypes: [],
      disabledTypes: [],
    },
    server: { port: 8080 },
  }),
}));

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

const mockSession = {
  recordAssistant: (_state: any, _content: string, _toolCalls: any, _model: string) =>
    Effect.succeed({ uuid: 'a1' }),
  recordToolResult: (
    _state: any,
    _parentUuid: string,
    _toolName: string,
    _toolCallId: string,
    _output: string
  ) => Effect.succeed({}),
  recordUser: (_state: any, _content: string) => Effect.succeed({ uuid: 'm1' }),
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
  model: 'test-model',
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
    hooks: {
      emit: () => Effect.succeed(undefined),
      emitDecision: () => Effect.succeed(null),
      register: () => Effect.succeed(() => {}),
      registerDecision: () => Effect.succeed(() => {}),
      reloadUserHooks: () => Effect.succeed(undefined),
    } as unknown as HookService,
    ...overrides,
  };
}

const AllMockLayer = Layer.mergeAll(
  Layer.succeed(CheckpointService, {
    snapshotBaseline: () => Effect.void,
    snapshotFinal: () => Effect.void,
    getCompletedTurns: () => Effect.succeed([]),
    getCheckpoints: () => Effect.succeed([]),
    getCheckpointDiff: () => Effect.succeed({ turnId: 0, files: [] }),
    revertCheckpointFiles: () =>
      Effect.succeed({
        reverted: false,
        throughTurnId: 0,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      }),
    previewRollbackDiff: () => Effect.succeed({ throughTurnId: 0, affectedTurns: [], diff: '' }),
    rollbackCodeToTurn: () =>
      Effect.succeed({
        reverted: false,
        throughTurnId: 0,
        affectedTurns: [],
        selectedFiles: [],
        restoreEntry: null,
      }),
    undoLastCodeRollback: () =>
      Effect.succeed({
        restored: false,
        conflict: false,
        conflictFiles: [],
        restoredFiles: [],
        remainingRolledBack: [],
      }),
    getLatestRestoreEntry: () => Effect.succeed(null),
  } as any),
  Layer.succeed(SessionService, {
    recordAssistant: () => Effect.succeed({ uuid: 'a1' }),
    recordUser: () => Effect.succeed({ uuid: 'u1' }),
    recordToolResult: () => Effect.succeed({}),
  } as any),
  Layer.succeed(HookService, {
    emit: () => Effect.succeed(undefined),
    emitDecision: () => Effect.succeed(null),
    register: () => Effect.succeed(() => {}),
    registerDecision: () => Effect.succeed(() => {}),
    reloadUserHooks: () => Effect.succeed(undefined),
  } as any),
  Layer.succeed(ToolExecutorService, {
    execute: () => Effect.succeed(''),
    executeBatch: (tcs: any[]) =>
      Effect.succeed(
        tcs.map((tc: any) => ({ type: 'ok' as const, id: tc.id, name: tc.name, output: '' }))
      ),
  } as any),
  Layer.succeed(ProjectRuntimeService, {
    prepareProject: () => Effect.void,
    resolveMainAgentProfile: () => undefined,
    resolveSubagentProfile: () => undefined,
    listAgentProfiles: () => [],
    getToolPolicy: () => ({
      allowedTools: undefined,
      allowedMcpServers: undefined,
      allowToolSearch: true,
      allowDeferredTools: false,
    }),
    setSessionProfile: () => {},
    getSessionProfile: () => undefined,
    disposeSession: () => Effect.void,
    disposeProject: () => Effect.void,
  } as any),
  Layer.succeed(TodoService, {
    read: () => [],
    write: () => {},
    reset: () => {},
  } as any),
  Layer.succeed(ContextService, {
    assemblePayload: () => ({
      messages: [{ role: 'user' as const, content: 'hi' }],
      compactedEvents: [],
      promptEstimate: 10,
      currentTurnId: 1,
      compactedTurnIds: new Set<number>(),
    }),
    compactIfNeeded: () => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 10 }),
    compactWithLLM: () => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 10 }),
  } as any),
  Layer.succeed(MemoryService, {
    getMemoryEnabled: () => false,
    setMemoryEnabled: () => {},
    loadMemoryForPrompt: () => '',
    flushSessionToMemory: () => Promise.resolve({ written: false, bytes: 0 }),
  } as any)
);

describe('agentLoop', () => {
  it('should yield text chunks from LLM stream', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield 'Hello';
          yield ' ';
          yield 'world';
        })(),
        response: Promise.resolve(Result.ok({ content: 'Hello world' })),
      }),
    };

    const deps = makeDeps();
    const opts = { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any };
    const q = Effect.runSync(Queue.unbounded<AgentEvent>());
    const effect = agentLoop(
      deps.executor,
      deps.hooks,
      deps.maxSteps,
      deps.maxStopContinuations,
      opts,
      q
    );
    await Effect.runPromise(effect.pipe(Effect.provide(AllMockLayer)));
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents.map((e: any) => e.text)).toEqual(['Hello', ' ', 'world']);
  });

  it('should handle empty LLM stream gracefully', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: '' })),
      }),
    };

    const deps = makeDeps();
    const opts = { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any };
    const q = Effect.runSync(Queue.unbounded<AgentEvent>());
    const effect = agentLoop(
      deps.executor,
      deps.hooks,
      deps.maxSteps,
      deps.maxStopContinuations,
      opts,
      q
    );
    await Effect.runPromise(effect.pipe(Effect.provide(AllMockLayer)));
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents).toHaveLength(0);
  });

  it('should feed bash tool results back to LLM', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield '\n[Using: execute_command]\n';
        })(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'execute_command', arguments: { command: 'git status' } },
            ],
          })
        ),
      }),
    };

    const toolRegistryWithBash = {
      ...mockToolRegistry,
      describeAll: () => [
        {
          name: 'execute_command',
          description: 'Run shell command',
          parameters: { type: 'object' },
        },
      ],
    };

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('On branch main\nnothing to commit'),
      executeBatch: (_toolCalls: any[]) =>
        Effect.succeed(
          _toolCalls.map((tc: any) => ({
            type: 'ok' as const,
            id: tc.id,
            name: tc.name,
            output: 'On branch main\nnothing to commit',
          }))
        ),
    };

    const deps = makeDeps({
      maxSteps: 1,
      runtime: { listAgentProfiles: () => [] } as any,
      executor: mockExecutor as any,
    });
    const opts = { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any };
    const q = Effect.runSync(Queue.unbounded<AgentEvent>());
    const effect = agentLoop(
      deps.executor,
      deps.hooks,
      deps.maxSteps,
      deps.maxStopContinuations,
      opts,
      q
    );
    await Effect.runPromise(effect.pipe(Effect.provide(AllMockLayer)));
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const toolResults = events.filter(
      (e: AgentEvent): e is Extract<AgentEvent, { _tag: 'ToolResult' }> => e._tag === 'ToolResult'
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.output).toBe('On branch main\nnothing to commit');
    expect(toolResults[0]!.ok).toBe(true);
  });

  it('should forward tool-call markers from LLM stream', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield '\n[Using: readFile]\n';
        })(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [{ id: 'tc1', name: 'readFile', arguments: { path: 'test.txt' } }],
          })
        ),
      }),
    };

    const toolRegistryWithTool = {
      ...mockToolRegistry,
      describeAll: () => [
        { name: 'readFile', description: 'Read a file', parameters: { type: 'object' } },
      ],
    };

    const mockExecutor = {
      execute: (_name: string, _args: Record<string, unknown>, _opts?: any) =>
        Effect.succeed('file content'),
      executeBatch: (_toolCalls: any[]) =>
        Effect.succeed(
          _toolCalls.map((tc: any) => ({
            type: 'ok' as const,
            id: tc.id,
            name: tc.name,
            output: 'file content',
          }))
        ),
    };

    const deps = makeDeps({
      maxSteps: 1,
      runtime: { listAgentProfiles: () => [] } as any,
      executor: mockExecutor as any,
    });
    const opts = { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any };
    const q = Effect.runSync(Queue.unbounded<AgentEvent>());
    const effect = agentLoop(
      deps.executor,
      deps.hooks,
      deps.maxSteps,
      deps.maxStopContinuations,
      opts,
      q
    );
    await Effect.runPromise(effect.pipe(Effect.provide(AllMockLayer)));
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const textEvents = events.filter((e: any) => e._tag === 'LlmChunk');
    expect(textEvents.map((e: any) => e.text)).toEqual(['\n[Using: readFile]\n']);
  });

  it('should pass skillInstruction into the system prompt sent to LLM', async () => {
    let capturedSystem: string | undefined;
    const mockLlm = {
      completeStream: (params: any) => {
        capturedSystem = params.system;
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(Result.ok({ content: 'done' })),
        };
      },
    };

    const deps = makeDeps();
    const opts = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      skillInstruction: 'Use strict TypeScript',
    };
    const q = Effect.runSync(Queue.unbounded<AgentEvent>());
    const effect = agentLoop(
      deps.executor,
      deps.hooks,
      deps.maxSteps,
      deps.maxStopContinuations,
      opts,
      q
    );
    await Effect.runPromise(effect.pipe(Effect.provide(AllMockLayer)));

    expect(capturedSystem).toContain('Use strict TypeScript');
  });

  it('should yield a single maxSteps error and a single turn.end hook when maxSteps is exhausted', async () => {
    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {
          yield 'calling tool';
        })(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [{ id: 'tc1', name: 'read_file', arguments: { path: 'x' } }],
          })
        ),
      }),
    };

    const mockExecutor = {
      executeBatch: (_toolCalls: any[]) =>
        Effect.succeed(
          _toolCalls.map((tc: any) => ({
            type: 'ok' as const,
            id: tc.id,
            name: tc.name,
            output: 'file content',
          }))
        ),
    };

    const turnEndCalls: any[] = [];
    const trackingHooks = {
      emit: (eventName: string, payload?: any) => {
        if (eventName === 'agent.turn.end') {
          turnEndCalls.push(payload);
        }
        return Effect.succeed(undefined);
      },
      emitDecision: () => Effect.succeed(null),
      register: () => Effect.succeed(() => {}),
      registerDecision: () => Effect.succeed(() => {}),
      reloadUserHooks: () => Effect.succeed(undefined),
    };

    const deps = makeDeps({
      maxSteps: 1,
      runtime: { listAgentProfiles: () => [] } as any,
      executor: mockExecutor as any,
      hooks: trackingHooks as unknown as HookService,
    });
    const opts = { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any };
    const q = Effect.runSync(Queue.unbounded<AgentEvent>());
    const effect = agentLoop(
      deps.executor,
      deps.hooks,
      deps.maxSteps,
      deps.maxStopContinuations,
      opts,
      q
    );
    await Effect.runPromise(effect.pipe(Effect.provide(AllMockLayer)));
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const maxStepErrors = events.filter(
      (e: any) => e._tag === 'Error' && e.error?.code === 'MAX_STEPS_REACHED'
    );
    expect(maxStepErrors).toHaveLength(1);
    expect(turnEndCalls).toHaveLength(1);
    expect(turnEndCalls[0].status).toBe('maxSteps');
  });
});
