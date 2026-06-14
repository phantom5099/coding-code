import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, Queue } from 'effect';
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

import { agentLoop } from '../../src/agent/agent.js';
import { HookService } from '../../src/hooks/registry.js';
import { Result } from '../../src/core/result.js';
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

describe('agentLoop hooks type', () => {
  it('should accept a properly typed HookService mock', async () => {
    const mockHooks = {
      emit: (_point: any, _payload: any) => Effect.succeed(undefined),
      emitDecision: (_point: any, _payload: any) => Effect.succeed(null),
      register: (_point: any, _handler: any, _opts?: any) => Effect.succeed(() => {}),
      registerDecision: (_point: any, _handler: any, _opts?: any) => Effect.succeed(() => {}),
      reloadUserHooks: (_cwd: string) => Effect.succeed(undefined),
    } as unknown as HookService;

    const mockLlm = {
      completeStream: () => ({
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: '' })),
      }),
    };

    const mockState = {
      sessionId: 'type-test',
      cwd: '/tmp',
      projectPath: 'test',
      transcriptPath: '/tmp/test.jsonl',
      indexPath: '/tmp/test.index.json',
      messageCount: 0,
      currentTurnId: 1,
      sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
      title: 'type-test',
      usage: undefined,
      promptEstimate: 0,
      memorySnapshot: '',
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    const result = await Effect.runPromise(
      agentLoop(
        null as any,
        mockHooks,
        1,
        2,
        { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any },
        q
      ).pipe(Effect.provide(AllMockLayer)) as any
    );

    expect(result).toBeDefined();
  });
});
