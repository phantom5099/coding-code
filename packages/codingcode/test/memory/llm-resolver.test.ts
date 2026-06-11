import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LLMClient } from '../../src/llm/client.js';
import type { SelectableModel } from '../../src/llm/factory.js';

const { mockFindModel, mockCreateClient } = vi.hoisted(() => ({
  mockFindModel: vi.fn(() => null),
  mockCreateClient: vi.fn(),
}));

vi.mock('../../src/llm/factory.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    findModel: mockFindModel,
    createClient: mockCreateClient,
  };
});

import { resolveLLM } from '../../src/llm/llm-resolver.js';

const fallbackClient = {} as LLMClient;

describe('resolveLLM (memory)', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns fallback when target is empty', async () => {
    const result = await resolveLLM('', fallbackClient);
    expect(result).toBe(fallbackClient);
  });

  it('returns fallback when target is whitespace-only', async () => {
    const result = await resolveLLM('   ', fallbackClient);
    expect(result).toBe(fallbackClient);
  });

  it('returns fallback when model not found', async () => {
    mockFindModel.mockReturnValue(null);
    const result = await resolveLLM('nonexistent-model', fallbackClient);
    expect(result).toBe(fallbackClient);
  });

  it('returns null when fallback is null and create fails', async () => {
    mockFindModel.mockReturnValue({ id: 'claude-opus-4-7' } as SelectableModel);
    mockCreateClient.mockRejectedValue(new Error('creation failed'));
    const result = await resolveLLM('claude-opus-4-7', null);
    expect(result).toBeNull();
  });

  it('returns null when fallback is null and create returns error', async () => {
    mockFindModel.mockReturnValue({ id: 'claude-opus-4-7' } as SelectableModel);
    mockCreateClient.mockResolvedValue({ ok: false, error: 'error' });
    const result = await resolveLLM('claude-opus-4-7', null);
    expect(result).toBeNull();
  });

  it('creates and returns client when model matches by id', async () => {
    const client = { modelInfo: { maxTokens: 4096 } } as LLMClient;
    mockFindModel.mockReturnValue({ id: 'claude-opus-4-7@ANTHROPIC_API_KEY' } as SelectableModel);
    mockCreateClient.mockResolvedValue({ ok: true, value: client });
    const result = await resolveLLM('claude-opus-4-7@ANTHROPIC_API_KEY', fallbackClient);
    expect(result).toBe(client);
  });

  it('creates and returns client when model matches by bare model id', async () => {
    const client = { modelInfo: { maxTokens: 4096 } } as LLMClient;
    mockFindModel.mockReturnValue({ id: 'deepseek-chat@DEEPSEEK_API_KEY', model: 'deepseek-chat' } as SelectableModel);
    mockCreateClient.mockResolvedValue({ ok: true, value: client });
    const result = await resolveLLM('deepseek-chat', fallbackClient);
    expect(result).toBe(client);
  });
});
