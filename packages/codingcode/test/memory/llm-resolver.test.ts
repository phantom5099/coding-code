import { describe, it, expect, vi, afterEach } from 'vitest';
import { Effect } from 'effect';
import { resolveLLM } from '../../src/llm/llm-resolver.js';
import { LLMFactoryService } from '../../src/llm/factory.js';
import { AgentError } from '../../src/core/error.js';
import type { LLMClient } from '../../src/llm/client.js';
import type { SelectableModel } from '../../src/llm/factory.js';

const { mockFindModel, mockCreateClient } = vi.hoisted(() => ({
  mockFindModel: vi.fn(),
  mockCreateClient: vi.fn(),
}));

const mockFactory = {
  findModel: mockFindModel,
  createClient: mockCreateClient,
  listModels: vi.fn(() => Effect.succeed([])),
  getActiveEntry: vi.fn(() => Effect.succeed({})),
  switchModel: vi.fn(() => Effect.succeed({})),
  getLLMClient: vi.fn(() => Effect.succeed({})),
} as any;

const fallbackClient = {} as LLMClient;

async function runResolveLLM(target: string | null | undefined, fallback: LLMClient | null) {
  return Effect.runPromise(
    resolveLLM(target, fallback).pipe(Effect.provideService(LLMFactoryService, mockFactory))
  );
}

describe('resolveLLM (memory)', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns fallback when target is empty', async () => {
    const result = await runResolveLLM('', fallbackClient);
    expect(result).toBe(fallbackClient);
  });

  it('returns fallback when target is whitespace-only', async () => {
    const result = await runResolveLLM('   ', fallbackClient);
    expect(result).toBe(fallbackClient);
  });

  it('returns fallback when model not found', async () => {
    mockFindModel.mockReturnValue(Effect.succeed(null));
    const result = await runResolveLLM('nonexistent-model', fallbackClient);
    expect(result).toBe(fallbackClient);
  });

  it('returns null when fallback is null and create fails', async () => {
    mockFindModel.mockReturnValue(Effect.succeed({ id: 'claude-opus-4-7' } as SelectableModel));
    mockCreateClient.mockReturnValue(
      Effect.fail(new AgentError('CONFIG_INVALID', 'creation failed'))
    );
    const result = await runResolveLLM('claude-opus-4-7', null);
    expect(result).toBeNull();
  });

  it('returns null when fallback is null and create returns error', async () => {
    mockFindModel.mockReturnValue(Effect.succeed({ id: 'claude-opus-4-7' } as SelectableModel));
    mockCreateClient.mockReturnValue(Effect.fail(new AgentError('CONFIG_INVALID', 'error')));
    const result = await runResolveLLM('claude-opus-4-7', null);
    expect(result).toBeNull();
  });

  it('creates and returns client when model matches by id', async () => {
    const client = { modelInfo: { maxTokens: 4096 } } as LLMClient;
    mockFindModel.mockReturnValue(
      Effect.succeed({ id: 'claude-opus-4-7@ANTHROPIC_API_KEY' } as SelectableModel)
    );
    mockCreateClient.mockReturnValue(Effect.succeed(client));
    const result = await runResolveLLM('claude-opus-4-7@ANTHROPIC_API_KEY', fallbackClient);
    expect(result).toBe(client);
  });

  it('creates and returns client when model matches by bare model id', async () => {
    const client = { modelInfo: { maxTokens: 4096 } } as LLMClient;
    mockFindModel.mockReturnValue(
      Effect.succeed({
        id: 'deepseek-chat@DEEPSEEK_API_KEY',
        model: 'deepseek-chat',
      } as SelectableModel)
    );
    mockCreateClient.mockReturnValue(Effect.succeed(client));
    const result = await runResolveLLM('deepseek-chat', fallbackClient);
    expect(result).toBe(client);
  });
});
