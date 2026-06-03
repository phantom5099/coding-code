import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveMemoryLLM } from '../../src/memory/llm-resolver.js';
import type { LLMClient } from '../../src/llm/client.js';
import type { MemoryConfig } from '@codingcode/infra';

vi.mock('../../src/llm/factory.js', () => ({
  listModels: vi.fn(() => ({
    ok: true,
    value: [
      {
        id: 'claude-opus-4-7',
        model: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        provider: 'anthropic',
      },
      {
        id: 'deepseek@deepseek',
        model: 'deepseek-chat',
        name: 'DeepSeek Chat',
        provider: 'deepseek',
      },
    ],
  })),
  createClient: vi.fn(async (_modelInfo: any) => ({
    ok: true,
    value: {
      complete: () => Promise.resolve({ ok: true, value: { content: '' } }),
      completeStream: () => ({
        stream: async function* () {},
        response: Promise.resolve({ ok: true, value: { content: '' } }),
      }),
      modelInfo: {
        provider: 'mock',
        model: 'mock',
        maxTokens: 4096,
        supportsToolCalling: true,
        supportsStreaming: true,
      },
    } as any,
  })),
}));

describe('Memory LLM Resolver', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  const createCfg = (model: string): MemoryConfig => ({
    enabled: true,
    model,
    projectFile: '',
    userFile: '',
    maxBytes: 16384,
    promptMaxBytes: 8192,
    extraTypes: [],
    disabledTypes: [],
  });

  it('returns fallback when model is empty', async () => {
    const cfg = createCfg('');
    const fallback = {} as LLMClient;
    const result = await resolveMemoryLLM(cfg, fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback when listModels fails', async () => {
    const { listModels } = await import('../../src/llm/factory.js');
    vi.mocked(listModels).mockReturnValue({ ok: false, error: 'error' } as any);

    const cfg = createCfg('claude-opus-4-7');
    const fallback = {} as LLMClient;
    const result = await resolveMemoryLLM(cfg, fallback);
    expect(result).toBe(fallback);
  });

  it('returns fallback when model not found', async () => {
    const cfg = createCfg('nonexistent-model');
    const fallback = {} as LLMClient;
    const result = await resolveMemoryLLM(cfg, fallback);
    expect(result).toBe(fallback);
  });

  it('returns null fallback when create fails', async () => {
    const { createClient } = await import('../../src/llm/factory.js');
    vi.mocked(createClient).mockRejectedValue(new Error('creation failed'));

    const cfg = createCfg('claude-opus-4-7');
    const result = await resolveMemoryLLM(cfg, null);
    expect(result).toBe(null);
  });

  it('returns null fallback when create returns error', async () => {
    const { createClient } = await import('../../src/llm/factory.js');
    vi.mocked(createClient).mockResolvedValue({ ok: false, error: 'error' } as any);

    const cfg = createCfg('claude-opus-4-7');
    const result = await resolveMemoryLLM(cfg, null);
    expect(result).toBe(null);
  });

  it('creates and returns client when model matches by id', async () => {
    const cfg = createCfg('claude-opus-4-7');
    const fallback = {} as LLMClient;
    const result = await resolveMemoryLLM(cfg, fallback);
    expect(result).not.toBe(fallback);
  });

  it('creates and returns client when model matches by bare id', async () => {
    const cfg = createCfg('deepseek-chat');
    const fallback = {} as LLMClient;
    const result = await resolveMemoryLLM(cfg, fallback);
    expect(result).not.toBe(fallback);
  });
});
