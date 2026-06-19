import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, Queue, Chunk } from 'effect';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';
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

import { agentLoop } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';
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

const mockHooks = {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
} as any;

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
  title: 'concurrent',
  usage: undefined,
  memorySnapshot: '',
};

describe('agentLoop concurrent tool execution', () => {
  it('should execute multiple tool calls concurrently', async () => {
    const executionOrder: string[] = [];
    let releaseBarrier!: () => void;
    const barrierPromise = new Promise<void>((r) => {
      releaseBarrier = r;
    });

    const mockLlm = {
      completeStream: (_params: any) => ({
        stream: (async function* () {})(),
        response: Promise.resolve(
          Result.ok({
            content: '',
            toolCalls: [
              { id: 'tc1', name: 'tool_a', arguments: {} },
              { id: 'tc2', name: 'tool_b', arguments: {} },
              { id: 'tc3', name: 'tool_c', arguments: {} },
            ],
          })
        ),
      }),
    };

    const mockExecutor = {
      execute: (name: string, _args: Record<string, unknown>, _opts?: any) =>
        name === 'tool_a'
          ? Effect.gen(function* () {
              executionOrder.push('tool_a_start');
              yield* Effect.promise(() => barrierPromise);
              executionOrder.push(name);
              return `result-${name}`;
            })
          : Effect.gen(function* () {
              executionOrder.push(name);
              return `result-${name}`;
            }),
      executeBatch: (toolCalls: any[], _sessionId?: string) =>
        Effect.all(
          toolCalls.map((tc: any) =>
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
            )
          ),
          { concurrency: 'unbounded' }
        ),
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    const runPromise = Effect.runPromise(
      agentLoop(
        mockExecutor as any,
        mockHooks,
        1,
        2,
        { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any },
        q
      ).pipe(Effect.provide(AllMockLayer)) as any
    );

    // Wait for tool_a to start, then immediately release barrier.
    // tool_b and tool_c finish synchronously, so they must appear first.
    await vi.waitFor(() => executionOrder.includes('tool_a_start'), { timeout: 5000 });
    releaseBarrier();
    await runPromise;
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    expect(executionOrder).toHaveLength(4);
    expect(executionOrder[0]).toBe('tool_a_start');
    expect(executionOrder.indexOf('tool_b')).toBeLessThan(executionOrder.indexOf('tool_a'));
    expect(executionOrder.indexOf('tool_c')).toBeLessThan(executionOrder.indexOf('tool_a'));
    expect(executionOrder[executionOrder.length - 1]).toBe('tool_a');

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
        Effect.all(
          toolCalls.map((tc: any) =>
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
            )
          ),
          { concurrency: 'unbounded' }
        ),
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(
        mockExecutor as any,
        mockHooks,
        1,
        2,
        { state: mockState, llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any },
        q
      ).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const toolResults = events.filter((e: any) => e._tag === 'ToolResult');
    expect(toolResults).toHaveLength(3);
    expect(toolResults.find((r: any) => r.name === 'good_tool')?.ok).toBe(true);
    expect(toolResults.find((r: any) => r.name === 'good_tool2')?.ok).toBe(true);
    expect(toolResults.find((r: any) => r.name === 'bad_tool')?.ok).toBe(false);
  });
});
