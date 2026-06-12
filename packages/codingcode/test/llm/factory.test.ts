import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import { tmpdir } from 'os';

const mockCatalog = {
  providers: [
    {
      name: 'provider-a',
      driver: 'openai',
      base_url: 'https://api.a.com',
      api_key_env: 'API_KEY_A',
      default_model: 'model-x',
      models: [
        { id: 'model-x', name: 'Model X' },
        { id: 'model-y', name: 'Model Y' },
      ],
    },
  ],
};

function mockFs() {
  vi.doMock('fs', async (importOriginal: any) => {
    const orig = await importOriginal();
    return {
      ...orig,
      existsSync: (p: string) => (p.includes('models.json') ? true : orig.existsSync(p)),
      readFileSync: (p: string, enc?: any) =>
        p.includes('models.json') ? JSON.stringify(mockCatalog) : orig.readFileSync(p, enc),
    };
  });
}

async function initWith(activeModel: { model: string; apiKeyEnv: string } | undefined) {
  const { initWorkspace } = await import('../../src/core/workspace.js');
  initWorkspace({
    workspaceCwd: tmpdir(),
    config: { activeModel } as any,
  });
}

describe('switchModel - persists to config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls updateActiveModel with model and api_key_env after switching', async () => {
    const updateActiveModel = vi.fn();
    vi.doMock('@codingcode/infra', async (importOriginal: any) => {
      const orig = await importOriginal();
      return { ...orig, updateActiveModel };
    });
    mockFs();
    await initWith({ model: 'model-x', apiKeyEnv: 'API_KEY_A' });

    const { switchModel, LLMFactoryService } = await import('../../src/llm/factory.js');
    const factoryLayer = LLMFactoryService.Default;
    const result = Effect.runSync(switchModel('model-y@API_KEY_A').pipe(Effect.provide(factoryLayer), Effect.either));
    expect(result._tag).toBe('Right');
    if (result._tag === 'Right') {
      expect(result.right.id).toBe('model-y@API_KEY_A');
    }
    expect(updateActiveModel).toHaveBeenCalledWith('model-y', 'API_KEY_A');
  });

  it('does not call updateActiveModel when model id is not found', async () => {
    const updateActiveModel = vi.fn();
    vi.doMock('@codingcode/infra', async (importOriginal: any) => {
      const orig = await importOriginal();
      return { ...orig, updateActiveModel };
    });
    mockFs();
    await initWith({ model: 'model-x', apiKeyEnv: 'API_KEY_A' });

    const { switchModel, LLMFactoryService } = await import('../../src/llm/factory.js');
    const factoryLayer = LLMFactoryService.Default;
    const result = Effect.runSync(switchModel('nonexistent@API_KEY_A').pipe(Effect.provide(factoryLayer), Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.message).toContain('not found');
    }
    expect(updateActiveModel).not.toHaveBeenCalled();
  });
});

describe('getActiveEntry - activeModel priority', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses activeModel from config when it matches a catalog entry', async () => {
    mockFs();
    await initWith({ model: 'model-y', apiKeyEnv: 'API_KEY_A' });

    const { getActiveEntry, LLMFactoryService } = await import('../../src/llm/factory.js');
    const factoryLayer = LLMFactoryService.Default;
    const result = Effect.runSync(getActiveEntry().pipe(Effect.provide(factoryLayer), Effect.either));
    expect(result._tag).toBe('Right');
    if (result._tag === 'Right') {
      expect(result.right.id).toBe('model-y@API_KEY_A');
    }
  });

  it('returns error when activeModel is not set in config', async () => {
    await initWith(undefined);

    const { getActiveEntry, LLMFactoryService } = await import('../../src/llm/factory.js');
    const factoryLayer = LLMFactoryService.Default;
    const result = Effect.runSync(getActiveEntry().pipe(Effect.provide(factoryLayer), Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.code).toBe('CONFIG_INVALID');
      expect(result.left.message).toContain('activeModel');
    }
  });

  it('returns error when activeModel does not match any catalog entry', async () => {
    mockFs();
    await initWith({ model: 'nonexistent', apiKeyEnv: 'UNKNOWN_KEY' });

    const { getActiveEntry, LLMFactoryService } = await import('../../src/llm/factory.js');
    const factoryLayer = LLMFactoryService.Default;
    const result = Effect.runSync(getActiveEntry().pipe(Effect.provide(factoryLayer), Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.code).toBe('CONFIG_INVALID');
      expect(result.left.message).toContain('nonexistent');
    }
  });
});

describe('createClient - API key validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns CONFIG_MISSING when API key env is not set', async () => {
    mockFs();
    await initWith({ model: 'model-x', apiKeyEnv: 'API_KEY_A' });

    const { getActiveEntry, createClient, LLMFactoryService } = await import('../../src/llm/factory.js');
    const factoryLayer = LLMFactoryService.Default;
    const entryResult = await Effect.runPromise(getActiveEntry().pipe(Effect.provide(factoryLayer), Effect.either));
    expect(entryResult._tag).toBe('Right');
    if (entryResult._tag === 'Left') return;

    delete (process.env as any).API_KEY_A;
    delete (process.env as any).OPENAI_API_KEY;

    const result = await Effect.runPromise(createClient(entryResult.right).pipe(Effect.provide(factoryLayer), Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.code).toBe('CONFIG_MISSING');
      expect(result.left.message).toContain('API_KEY_A');
    }
  });

  it('succeeds when OPENAI_API_KEY fallback is set', async () => {
    mockFs();
    await initWith({ model: 'model-x', apiKeyEnv: 'API_KEY_A' });

    const { getActiveEntry, createClient, LLMFactoryService } = await import('../../src/llm/factory.js');
    const factoryLayer = LLMFactoryService.Default;
    const entryResult = await Effect.runPromise(getActiveEntry().pipe(Effect.provide(factoryLayer), Effect.either));
    expect(entryResult._tag).toBe('Right');
    if (entryResult._tag === 'Left') return;

    delete (process.env as any).API_KEY_A;
    (process.env as any).OPENAI_API_KEY = 'sk-test';

    const result = await Effect.runPromise(createClient(entryResult.right).pipe(Effect.provide(factoryLayer), Effect.either));
    expect(result._tag).toBe('Right');
  });
});
