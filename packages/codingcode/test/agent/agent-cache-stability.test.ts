import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, Queue } from 'effect';
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
  sessionId: 'cache-test-sid',
  cwd: '/tmp/cache-test',
  projectPath: 'cache-test',
  transcriptPath: '/tmp/cache-test.jsonl',
  indexPath: '/tmp/cache-test.index.json',
  messageCount: 0,
  currentTurnId: 1,
  sessionMeta: { model: 'test-model', createdAt: new Date().toISOString() } as any,
  title: 'cache-test',
  usage: undefined,
  promptEstimate: 0,
  memorySnapshot: '',
};

function makeCapturingLlm() {
  const captured: { system?: string } = {};
  const llm = {
    completeStream: (params: any) => {
      captured.system = params.system;
      return {
        stream: (async function* () {})(),
        response: Promise.resolve(Result.ok({ content: '' })),
      };
    },
    modelInfo: { maxTokens: 1000 },
  } as any;
  return { llm, captured };
}

async function runOnce(llm: any) {
  const q = Effect.runSync(Queue.unbounded<any>());
  await Effect.runPromise(
    agentLoop(
      null as any,
      mockHooks,
      1,
      0,
      { state: mockState, llm },
      q
    ).pipe(Effect.provide(AllMockLayer)) as any
  );
}

describe('LLM prompt cache stability', () => {
  it('system prompt does not include deferred tools catalog', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm);
    expect(captured.system).toBeDefined();
    expect(captured.system).not.toContain('<available-deferred-tools>');
    expect(captured.system).not.toContain('</available-deferred-tools>');
  });

  it('system prompt is byte-identical across consecutive turns', async () => {
    const { llm, captured } = makeCapturingLlm();
    await runOnce(llm);
    const first = captured.system;
    expect(first).toBeDefined();
    await runOnce(llm);
    const second = captured.system;
    expect(second).toBe(first);
  });
});
