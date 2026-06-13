import { describe, it, expect, vi, afterEach } from 'vitest';
import { Effect } from 'effect';
import { LLMFactoryService } from '../../../src/llm/factory.js';
import { AgentError } from '../../../src/core/error.js';
import type { LLMClient } from '../../../src/llm/client.js';
import type { SelectableModel } from '../../../src/llm/factory.js';

const { mockFindModel, mockCreateClient } = vi.hoisted(() => ({
  mockFindModel: vi.fn(() => Effect.succeed(null)),
  mockCreateClient: vi.fn(() => Effect.succeed(null)),
}));

const mockFactory = {
  listModels: () => Effect.succeed([]),
  findModel: mockFindModel,
  getActiveEntry: () => Effect.fail(new AgentError('CONFIG_INVALID', 'no active entry')),
  switchModel: (_id: string) => Effect.fail(new AgentError('CONFIG_INVALID', 'not found')),
  createClient: mockCreateClient,
  getLLMClient: () => Effect.fail(new AgentError('CONFIG_INVALID', 'no client')),
};

import { resolveLLM } from '../../../src/llm/llm-resolver.js';

const fakeFallback: LLMClient = {
  complete: () => Effect.succeed({ content: '', finishReason: 'stop' }),
  completeStream: () => ({
    stream: (async function* () {})(),
    response: Promise.resolve({ ok: true as const, value: { content: '', finishReason: 'stop' } }),
  }),
  modelInfo: {
    provider: 'fake',
    model: 'fake',
    maxTokens: 1,
    supportsToolCalling: false,
    supportsStreaming: false,
  },
};

async function runResolveLLM(target: string | null | undefined, fallback: LLMClient | null) {
  return Effect.runPromise(
    resolveLLM(target, fallback).pipe(Effect.provideService(LLMFactoryService, mockFactory as any)),
  );
}

describe('resolveLLM (compaction)', () => {
  afterEach(() => {
    vi.resetAllMocks();
    mockFindModel.mockReturnValue(Effect.succeed(null));
    mockCreateClient.mockReturnValue(Effect.succeed(null));
  });

  it('returns fallback when target is empty', async () => {
    const result = await runResolveLLM('', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when target is whitespace-only', async () => {
    const result = await runResolveLLM('   ', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when target is null', async () => {
    const result = await runResolveLLM(null, fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when target is undefined', async () => {
    const result = await runResolveLLM(undefined, fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns null when target empty and fallback is null', async () => {
    const result = await runResolveLLM('', null);
    expect(result).toBeNull();
  });

  it('returns fallback when model not found', async () => {
    mockFindModel.mockReturnValue(Effect.succeed(null));
    const result = await runResolveLLM('definitely-not-a-real-model-xyz', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when createClient throws', async () => {
    mockFindModel.mockReturnValue(Effect.succeed({ id: 'test-model' } as SelectableModel));
    mockCreateClient.mockReturnValue(Effect.fail(new AgentError('CONFIG_MISSING', 'creation failed')));
    const result = await runResolveLLM('test-model', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when createClient returns error', async () => {
    mockFindModel.mockReturnValue(Effect.succeed({ id: 'test-model' } as SelectableModel));
    mockCreateClient.mockReturnValue(Effect.fail(new AgentError('CONFIG_INVALID', 'error')));
    const result = await runResolveLLM('test-model', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns created client on success', async () => {
    const client = { modelInfo: { maxTokens: 100 } } as LLMClient;
    mockFindModel.mockReturnValue(Effect.succeed({ id: 'test-model' } as SelectableModel));
    mockCreateClient.mockReturnValue(Effect.succeed(client));
    const result = await runResolveLLM('test-model', fakeFallback);
    expect(result).toBe(client);
  });
});
