import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, Queue, Chunk } from 'effect';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
import { ProjectRuntimeService } from '../../src/runtime/project-runtime.js';
import { TodoService } from '../../src/agent/todo.js';
import { ContextService } from '../../src/context/service.js';
import { MemoryService } from '../../src/memory/index.js';

vi.mock('@codingcode/infra/config', () => ({
  loadConfig: () => ({
    context: { compactionModel: '' },
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
    recordAssistant: () => Effect.succeed({}),
    recordUser: () => Effect.succeed({}),
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

const mockState = {
  sessionId: 'test-session',
  cwd: process.cwd(),
  currentTurnId: 1,
  sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
  model: 'test-model',
  title: 'test',
  usage: undefined,
  mode: 'build' as const,
  permissionMode: 'default' as const,
  projectPath: 'test-project',
  transcriptPath: '/tmp/test.jsonl',
  indexPath: '/tmp/test.index.json',
  messageCount: 0,
  memorySnapshot: '',
};

describe('agentLoop plan.ready emission on turn-end', () => {
  it('emits plan.ready when turn ends naturally after submit_plan tool call', async () => {
    let callCount = 0;
    const mockLlm = {
      completeStream: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // First call: LLM emits submit_plan tool call
          return {
            stream: (async function* () {})(),
            response: Promise.resolve(
              Result.ok({
                content: '',
                toolCalls: [
                  {
                    id: 'tc-1',
                    name: 'submit_plan',
                    arguments: { title: 'My Plan', plan_content: '## Goal\nfix bug' },
                  },
                ],
              })
            ),
          };
        }
        // Second call: LLM emits pure content, turn ends
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(
            Result.ok({ content: 'Plan is ready for your review.', toolCalls: [] })
          ),
        };
      }),
    };

    const planReadyEmits: any[] = [];
    const mockHooks = {
      emit: vi.fn((point: string, payload: any) => {
        if (point === 'plan.ready') planReadyEmits.push(payload);
        return Effect.succeed(undefined);
      }),
      emitDecision: vi.fn(() => Effect.succeed(null)),
    } as any;

    const executor = {
      execute: () => Effect.succeed({ output: '' }),
      executeBatch: (tcs: any[]) =>
        Effect.succeed(
          tcs.map((tc: any) => {
            if (tc.name === 'submit_plan') {
              return {
                type: 'ok' as const,
                id: tc.id,
                name: tc.name,
                output: 'Plan written to /tmp/plans/my-plan.md',
              };
            }
            return { type: 'ok' as const, id: tc.id, name: tc.name, output: '' };
          })
        ),
    } as any;

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(executor, mockHooks, 5, 2, opts, q).pipe(Effect.provide(AllMockLayer)) as any
    );

    // Exactly one plan.ready emitted, at turn-end (after the second LLM call)
    expect(planReadyEmits).toHaveLength(1);
    expect(planReadyEmits[0]).toEqual({
      sessionId: mockState.sessionId,
      projectPath: mockState.cwd,
      title: 'My Plan',
    });
  });

  it('does NOT emit plan.ready when no submit_plan was called this turn', async () => {
    let callCount = 0;
    const mockLlm = {
      completeStream: vi.fn(() => {
        callCount++;
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(
            Result.ok({ content: 'Just a regular response', toolCalls: [] })
          ),
        };
      }),
    };

    const planReadyEmits: any[] = [];
    const mockHooks = {
      emit: vi.fn((point: string, payload: any) => {
        if (point === 'plan.ready') planReadyEmits.push(payload);
        return Effect.succeed(undefined);
      }),
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

    expect(planReadyEmits).toHaveLength(0);
  });

  it('does NOT switch profile after plan.ready (profile change is UI responsibility)', async () => {
    let callCount = 0;
    const setProfileCalls: any[] = [];
    const mockLlm = {
      completeStream: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return {
            stream: (async function* () {})(),
            response: Promise.resolve(
              Result.ok({
                content: '',
                toolCalls: [
                  {
                    id: 'tc-1',
                    name: 'submit_plan',
                    arguments: { title: 'My Plan', plan_content: 'x' },
                  },
                ],
              })
            ),
          };
        }
        return {
          stream: (async function* () {})(),
          response: Promise.resolve(Result.ok({ content: 'done', toolCalls: [] })),
        };
      }),
    };

    const mockRuntime = {
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
      setSessionProfile: (...args: any[]) => {
        setProfileCalls.push(args);
        return {};
      },
      getSessionProfile: () => undefined,
      disposeSession: () => Effect.void,
      disposeProject: () => Effect.void,
    };

    const layer = AllMockLayer.pipe(
      Layer.provide(Layer.succeed(ProjectRuntimeService, mockRuntime as any))
    );

    const mockHooks = {
      emit: () => Effect.succeed(undefined),
      emitDecision: () => Effect.succeed(null),
    } as any;

    const executor = {
      execute: () => Effect.succeed({ output: '' }),
      executeBatch: (tcs: any[]) =>
        Effect.succeed(
          tcs.map((tc: any) =>
            tc.name === 'submit_plan'
              ? { type: 'ok' as const, id: tc.id, name: tc.name, output: 'Plan written to /x' }
              : { type: 'ok' as const, id: tc.id, name: tc.name, output: '' }
          )
        ),
    } as any;

    const opts: RunStreamOptions = {
      state: mockState,
      llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(executor, mockHooks, 5, 2, opts, q).pipe(Effect.provide(layer)) as any
    );

    // Profile must NOT be switched as a side effect of plan submission
    // (UI button drives the switch)
    expect(setProfileCalls).toHaveLength(0);
  });
});
