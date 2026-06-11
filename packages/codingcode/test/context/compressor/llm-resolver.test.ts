import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LLMClient } from '../../../src/llm/client.js';

const { mockFindModel, mockCreateClient } = vi.hoisted(() => ({
  mockFindModel: vi.fn(() => null),
  mockCreateClient: vi.fn(),
}));

vi.mock('../../../src/llm/factory.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    findModel: mockFindModel,
    createClient: mockCreateClient,
  };
});

import { resolveLLM } from '../../../src/llm/llm-resolver.js';

const fakeFallback: LLMClient = {
  complete: async () => ({ ok: true as const, value: { content: '', finishReason: 'stop' } }),
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

describe('resolveLLM (compaction)', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns fallback when target is empty', async () => {
    const result = await resolveLLM('', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when target is whitespace-only', async () => {
    const result = await resolveLLM('   ', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when target is null', async () => {
    const result = await resolveLLM(null, fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when target is undefined', async () => {
    const result = await resolveLLM(undefined, fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns null when target empty and fallback is null', async () => {
    const result = await resolveLLM('', null);
    expect(result).toBeNull();
  });

  it('returns fallback when model not found', async () => {
    mockFindModel.mockReturnValue(null);
    const result = await resolveLLM('definitely-not-a-real-model-xyz', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when createClient throws', async () => {
    mockFindModel.mockReturnValue({ id: 'test-model' } as any);
    mockCreateClient.mockRejectedValue(new Error('creation failed'));
    const result = await resolveLLM('test-model', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns fallback when createClient returns error', async () => {
    mockFindModel.mockReturnValue({ id: 'test-model' } as any);
    mockCreateClient.mockResolvedValue({ ok: false, error: 'error' });
    const result = await resolveLLM('test-model', fakeFallback);
    expect(result).toBe(fakeFallback);
  });

  it('returns created client on success', async () => {
    const client = { modelInfo: { maxTokens: 100 } } as LLMClient;
    mockFindModel.mockReturnValue({ id: 'test-model' } as any);
    mockCreateClient.mockResolvedValue({ ok: true, value: client });
    const result = await resolveLLM('test-model', fakeFallback);
    expect(result).toBe(client);
  });
});
