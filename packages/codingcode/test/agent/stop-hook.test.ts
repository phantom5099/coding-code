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
    memory: {
      enabled: false,
      model: '',
      projectFile: '',
      userFile: '',
      maxBytes: 16384,
      promptMaxBytes: 8192,
      extraTypes: [],
      disabledTypes: [],
    },
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
  compactIfNeeded: vi.fn(() =>
    Promise.resolve({ didCompress: false, released: 0, promptEstimate: 10 })
  ),
  compactWithLLM: vi.fn(() =>
    Promise.resolve({ didCompress: false, released: 0, promptEstimate: 10 })
  ),
}));

import { agentLoop } from '../../src/agent/agent';
import { Result } from '../../src/core/result';
import type { RunStreamOptions } from '../../src/agent/types';
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

describe('agentLoop stop hook', () => {
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

  it('should continue iteration when stop hook returns continue decision', async () => {
    let callCount = 0;
    const mockLlm = {
      completeStream: vi.fn(() => {
        callCount++;
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(Result.ok({ content: `Response ${callCount}`, toolCalls: [] })),
        };
      }),
    };

    const emitDecisionFn = vi.fn((point: string) => {
      if (point === 'agent.turn.stop') {
        return Effect.succeed({ decision: 'continue', injection: 'Run again' });
      }
      return Effect.succeed(null);
    });

    const mockHooks = {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision: emitDecisionFn,
    } as any;

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop({} as any, mockHooks, 5, 2, opts, q).pipe(Effect.provide(AllMockLayer)) as any
    );

    expect(emitDecisionFn).toHaveBeenCalledWith(
      'agent.turn.stop',
      expect.objectContaining({ sessionId: mockState.sessionId })
    );
  });

  it('should respect maxStopContinuations limit', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: 'Response', toolCalls: [] })),
      })),
    };

    const mockHooks = {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision: vi.fn((point: string) => {
        if (point === 'agent.turn.stop') {
          return Effect.succeed({ decision: 'continue', injection: 'Continue' });
        }
        return Effect.succeed(null);
      }),
    } as any;

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      maxStopContinuations: 2,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop({} as any, mockHooks, 10, 10, opts, q).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const errorEvent = events.find((e: any) => e._tag === 'Error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as any)?.error?.code).toBe('AGENT_LOOP_DETECTED');
  });

  it('should use default maxStopContinuations of 2', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: 'Response', toolCalls: [] })),
      })),
    };

    let continueCount = 0;
    const mockHooks = {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision: vi.fn((point: string) => {
        if (point === 'agent.turn.stop') {
          continueCount++;
          return Effect.succeed({ decision: 'continue', injection: 'Continue' });
        }
        return Effect.succeed(null);
      }),
    } as any;

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop({} as any, mockHooks, 10, 2, opts, q).pipe(Effect.provide(AllMockLayer)) as any
    );

    expect(continueCount).toBeGreaterThanOrEqual(2);
  });

  it('should not continue if stop hook returns null', async () => {
    let llmCalls = 0;
    const mockLlm = {
      completeStream: vi.fn(() => {
        llmCalls++;
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(Result.ok({ content: 'Response', toolCalls: [] })),
        };
      }),
    };

    const mockHooks = {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision: vi.fn(() => Effect.succeed(null)),
    } as any;

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop({} as any, mockHooks, 5, 2, opts, q).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    expect(llmCalls).toBe(1);
    const doneEvent = events.find((e: any) => e._tag === 'Done');
    expect(doneEvent).toBeDefined();
  });

  it('should use injection message to record user event', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: 'Response', toolCalls: [] })),
      })),
    };

    const mockHooks = {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision: vi.fn((point: string) => {
        if (point === 'agent.turn.stop') {
          return Effect.succeed({ decision: 'continue', injection: 'Custom injection message' });
        }
        return Effect.succeed(null);
      }),
    } as any;

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      maxStopContinuations: 1,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop({} as any, mockHooks, 5, 2, opts, q).pipe(Effect.provide(AllMockLayer)) as any
    );
  });

  it('should use default injection if not provided', async () => {
    const mockLlm = {
      completeStream: vi.fn(() => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: 'Response', toolCalls: [] })),
      })),
    };

    const mockHooks = {
      emit: vi.fn(() => Effect.succeed(undefined)),
      emitDecision: vi.fn((point: string) => {
        if (point === 'agent.turn.stop') {
          return Effect.succeed({ decision: 'continue' });
        }
        return Effect.succeed(null);
      }),
    } as any;

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
      maxStopContinuations: 1,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop({} as any, mockHooks, 5, 2, opts, q).pipe(Effect.provide(AllMockLayer)) as any
    );
  });
});
