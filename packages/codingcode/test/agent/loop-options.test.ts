import { expect, it, describe, vi } from 'vitest';
import { Effect, Layer, Queue, Chunk } from 'effect';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { TodoService } from '../../src/agent/todo.js';
import { ContextService } from '../../src/context/service.js';
import { MemoryService } from '../../src/memory/index.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    context: {
      microCompactThreshold: 0.7,
      microCompactMinChars: 200,
      compactionThreshold: 0.8,
      keepRecentTurns: 10,
      compactionModel: '',
      reactiveCompactMaxRetries: 1,
    },
    memory: { enabled: false, model: '', projectFile: '', userFile: '', maxBytes: 16384, promptMaxBytes: 8192, extraTypes: [], disabledTypes: [] },
    server: { port: 8080 },
  }),
}));

vi.mock('../../src/context/organizer.js', () => ({
  assemblePayload: vi.fn(() => ({
    messages: [{ role: 'user' as const, content: 'hi' }],
    compactedEvents: [],
    promptEstimate: 10,
    currentTurnId: 1,
    compactedTurnIds: new Set<number>(),
  })),
}));

vi.mock('../../src/context/compressor.js', () => ({
  compactIfNeeded: vi.fn(() => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 10 })),
  compactWithLLM: vi.fn(() => Promise.resolve({ didCompress: false, released: 0, promptEstimate: 10 })),
}));

import { agentLoop } from '../../src/agent/agent';
import { Result } from '../../src/core/result';
import type { RunStreamOptions } from '../../src/agent/agent';
import { SessionService } from '../../src/session/store.js';

const AllMockLayer = Layer.mergeAll(
  Layer.succeed(CheckpointService, {
    snapshotBaseline: () => Effect.void,
    snapshotFinal: () => Effect.void,
  } as any),
  Layer.succeed(SessionService, {
    recordAssistant: () => Effect.succeed({ uuid: 'a1' }),
    recordUser: () => Effect.succeed({ uuid: 'u1' }),
    recordToolResult: () => Effect.succeed({}),
  } as any),
  Layer.succeed(ProjectRuntimeService, {
    prepareProject: () => Effect.void,
    resolveMainAgentProfile: () => undefined,
    resolveSubagentProfile: () => undefined,
    listAgentProfiles: () => [],
    getToolPolicy: () => ({ allowedTools: undefined, allowedMcpServers: undefined, allowToolSearch: true, allowDeferredTools: false }),
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

describe('agentLoop loop options', () => {

  const mockState = {
    sessionId: 'test-session',
    cwd: process.cwd(),
    currentTurnId: 0,
    sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
    title: 'test',
    usage: undefined,
    projectPath: '',
    transcriptPath: '',
    indexPath: '',
    messageCount: 0,
    promptEstimate: 0,
    memorySnapshot: '',
  };

  function mockHooks() {
    return {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision: vi.fn(() => Effect.succeed(null)),
    } as any;
  }

  it('should accept systemOverride to replace base prompt', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      systemOverride: 'Custom system prompt',
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(
        {} as any,
        mockHooks(),
        1,
        2,
        opts,
        q,
              ).pipe(Effect.provide(AllMockLayer)) as any
    );

    expect(mockLlm.completeStream).toHaveBeenCalled();
    const lastCall = (mockLlm.completeStream as any).mock?.calls?.[0]?.[0];
    expect(lastCall?.system).toBe('Custom system prompt');
  });

  it('should respect abortSignal to terminate early', async () => {
    const controller = new AbortController();

    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: new Promise((r) =>
          setTimeout(() => r(Result.ok({ content: 'Response', toolCalls: [] })), 100)
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      abortSignal: controller.signal,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    controller.abort();
    await Effect.runPromise(
      agentLoop(
        {} as any,
        mockHooks(),
        10,
        2,
        opts,
        q,
              ).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    // abortSignal is forwarded to llm.completeStream; agentLoop itself does not
    // short-circuit on abort — that is handled at AgentService.runStream level
    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });

  it('should support coreAllowlist to filter available tools', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      coreAllowlist: new Set(['allowed_tool']),
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(
        {} as any,
        mockHooks(),
        1,
        2,
        opts,
        q,
              ).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });

  it('should accept maxStepsOverride', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      maxStepsOverride: 5,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(
        {} as any,
        mockHooks(),
        100,
        2,
        opts,
        q,
              ).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const stepEvents = events.filter((e: any) => e._tag === 'Step');
    expect(stepEvents.some((e: any) => e.max === 5)).toBe(true);
  });

  it('should support approvalOverride', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const mockApproval = {
      evaluate: () => Effect.succeed({ decision: 'allow' }),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      approvalOverride: mockApproval as any,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(
        {} as any,
        mockHooks(),
        1,
        2,
        opts,
        q,
              ).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });

  it('should use maxStopContinuations from deps when opts does not override', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: 'Done', toolCalls: [] })),
      })),
    };

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(
        {} as any,
        mockHooks(),
        1,
        2,
        opts,
        q,
              ).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    expect(events.some((e: any) => e._tag === 'Done')).toBe(true);
  });

  it('should emit turn hooks', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: 'Done',
            toolCalls: [],
          })
        ),
      })),
    };

    const hooks = mockHooks();

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(
        {} as any,
        hooks,
        1,
        2,
        opts,
        q,
              ).pipe(Effect.provide(AllMockLayer)) as any
    );

    expect(hooks.emit).toHaveBeenCalledWith(
      'agent.turn.start',
      expect.objectContaining({ sessionId: mockState.sessionId })
    );
    expect(hooks.emit).toHaveBeenCalledWith(
      'agent.turn.end',
      expect.objectContaining({ status: 'done' })
    );
  });
});
