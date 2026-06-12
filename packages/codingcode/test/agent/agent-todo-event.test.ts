import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, Queue, Chunk } from 'effect';
import { CheckpointService } from '../../src/checkpoint/checkpoint-service.js';

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

import { agentLoop } from '../../src/agent/agent.js';
import { Result } from '../../src/core/result.js';
import { sharedTodoStore } from '../../src/agent/todo.js';
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
  } as any)
);

const mockHooks = {
  emit: () => Effect.succeed(undefined),
  emitDecision: () => Effect.succeed(null),
} as any;

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
  memorySnapshot: '',
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

    const todoUpdates = events.filter((e: any) => e._tag === 'TodoUpdate');
    expect(todoUpdates).toHaveLength(1);
    expect(todoUpdates[0].items).toEqual([
      { step: 'setup', status: 'pending' },
      { step: 'test', status: 'completed' },
    ]);
  });

  it('should not yield TodoUpdate when non-todo tools are called', async () => {
    sharedTodoStore.write('non-todo', []);

    const mockExecutor = {
      execute: () => Effect.succeed('done'),
      executeBatch: () =>
        Effect.succeed([
          { type: 'ok' as const, id: 'tc1', name: 'read_file', output: 'file content' },
        ]),
    };

    const q = Effect.runSync(Queue.unbounded<any>());
    await Effect.runPromise(
      agentLoop(
        mockExecutor as any,
        mockHooks,
        1,
        2,
        {
          state: { ...mockState, sessionId: 'non-todo' },
          llm: { ...mockLlm, modelInfo: { maxTokens: 1000 } } as any,
        },
        q
      ).pipe(Effect.provide(AllMockLayer)) as any
    );
    const events = Chunk.toArray(Effect.runSync(Queue.takeAll(q)));

    const todoUpdates = events.filter((e: any) => e._tag === 'TodoUpdate');
    expect(todoUpdates).toHaveLength(0);
  });
});
