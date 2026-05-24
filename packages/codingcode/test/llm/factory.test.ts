import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('switchModel - persists to config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls updateActiveModel with model and api_key_env after switching', async () => {
    const updateActiveModel = vi.fn();
    vi.doMock('@codingcode/infra', () => ({
      loadConfig: () => ({ activeModel: { model: 'model-x', apiKeyEnv: 'API_KEY_A' } }),
      updateActiveModel,
    }));
    vi.doMock('fs', async (importOriginal: any) => {
      const orig = await importOriginal();
      return {
        ...orig,
        existsSync: (p: string) => (p.includes('models.json') ? true : orig.existsSync(p)),
        readFileSync: (p: string, enc?: any) =>
          p.includes('models.json') ? JSON.stringify(mockCatalog) : orig.readFileSync(p, enc),
      };
    });

    const { switchModel } = await import('../../src/llm/factory.js');
    const result = switchModel('model-y@API_KEY_A');
    expect(result.ok).toBe(true);
    expect(updateActiveModel).toHaveBeenCalledWith('model-y', 'API_KEY_A', undefined, expect.any(String));
  });

  it('does not call updateActiveModel when model id is not found', async () => {
    const updateActiveModel = vi.fn();
    vi.doMock('@codingcode/infra', () => ({
      loadConfig: () => ({ activeModel: { model: 'model-x', apiKeyEnv: 'API_KEY_A' } }),
      updateActiveModel,
    }));
    vi.doMock('fs', async (importOriginal: any) => {
      const orig = await importOriginal();
      return {
        ...orig,
        existsSync: (p: string) => (p.includes('models.json') ? true : orig.existsSync(p)),
        readFileSync: (p: string, enc?: any) =>
          p.includes('models.json') ? JSON.stringify(mockCatalog) : orig.readFileSync(p, enc),
      };
    });

    const { switchModel } = await import('../../src/llm/factory.js');
    const result = switchModel('nonexistent@API_KEY_A');
    expect(result.ok).toBe(false);
    expect(updateActiveModel).not.toHaveBeenCalled();
  });
});

describe('getActiveEntry - activeModel priority', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses activeModel from config.yaml when it matches a catalog entry', async () => {
    vi.doMock('@codingcode/infra', () => ({
      loadConfig: () => ({ activeModel: { model: 'model-y', apiKeyEnv: 'API_KEY_A' } }),
    }));
    vi.doMock('fs', async (importOriginal: any) => {
      const orig = await importOriginal();
      return {
        ...orig,
        existsSync: (p: string) => (p.includes('models.json') ? true : orig.existsSync(p)),
        readFileSync: (p: string, enc?: any) =>
          p.includes('models.json') ? JSON.stringify(mockCatalog) : orig.readFileSync(p, enc),
      };
    });

    const { getActiveEntry } = await import('../../src/llm/factory.js');
    const result = getActiveEntry();
    expect(result.ok).toBe(true);
    expect(result.value?.id).toBe('model-y@API_KEY_A');
  });

  it('returns error when activeModel is not set in config', async () => {
    vi.doMock('@codingcode/infra', () => ({
      loadConfig: () => ({ activeModel: undefined }),
    }));

    const { getActiveEntry } = await import('../../src/llm/factory.js');
    const result = getActiveEntry();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CONFIG_INVALID');
    expect(result.error?.message).toContain('activeModel');
  });

  it('returns error when activeModel does not match any catalog entry', async () => {
    vi.doMock('@codingcode/infra', () => ({
      loadConfig: () => ({ activeModel: { model: 'nonexistent', apiKeyEnv: 'UNKNOWN_KEY' } }),
    }));
    vi.doMock('fs', async (importOriginal: any) => {
      const orig = await importOriginal();
      return {
        ...orig,
        existsSync: (p: string) => (p.includes('models.json') ? true : orig.existsSync(p)),
        readFileSync: (p: string, enc?: any) =>
          p.includes('models.json') ? JSON.stringify(mockCatalog) : orig.readFileSync(p, enc),
      };
    });

    const { getActiveEntry } = await import('../../src/llm/factory.js');
    const result = getActiveEntry();
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CONFIG_INVALID');
    expect(result.error?.message).toContain('nonexistent');
  });
});
