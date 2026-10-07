import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

const mockCatalog = {
  providers: [
    {
      name: 'provider-a',
      driver: 'openai',
      base_url: 'https://api.a.com',
      api_key_env: 'API_KEY_A',
      default_model: 'model-x',
      models: [
        { id: 'model-x', name: 'Model X', context_window: 32000 },
        { id: 'model-y', name: 'Model Y' },
      ],
    },
    {
      name: 'provider-b',
      driver: 'deepseek',
      base_url: 'https://api.b.com',
      api_key_env: 'API_KEY_B',
      default_model: 'model-x',
      models: [{ id: 'model-x', name: 'Model X' }],
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

/** catalog.ts 的 activeModel 来自 loadConfig()，与 updateActiveModel 同模块，一并桩掉。 */
function mockActiveModel(
  activeModel: { model: string; apiKeyEnv: string } | undefined,
  extra: Record<string, unknown> = {}
) {
  vi.doMock('../../src/infra/config.js', async (importOriginal: any) => {
    const orig = await importOriginal();
    return { ...orig, loadConfig: () => ({ activeModel }), ...extra };
  });
}

/** 消费完整条流；首个 part 前抛出的错误在此暴露 */
async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iterable) {
    // 只是把迭代推进到实际调用点
  }
}

/**
 * 用真实的 LlmLayer 走一次 completeStream，只观察模型解析阶段的失败。
 * Tag 与 Layer 必须取自同一份 import 图，故两者都在调用点动态导入。
 */
async function streamOnce(model: string) {
  const { LLMService } = await import('../../src/llm/port.js');
  const { LlmLayer } = await import('../../src/llm/llm.js');
  return Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      yield* Effect.tryPromise({
        try: () => drain(llm.completeStream({ messages: [] }, model)),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      });
    }).pipe(Effect.provide(LlmLayer), Effect.either)
  );
}

describe('catalog - listModels / findModel', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('flattens provider x model into {model}@{provider} ids', async () => {
    mockFs();
    mockActiveModel(undefined);
    const { listModels } = await import('../../src/infra/models.js');

    const ids = listModels().map((m) => m.id);
    expect(ids).toEqual(['model-x@provider-a', 'model-y@provider-a', 'model-x@provider-b']);
  });

  it('prefers the exact compound id over a bare-name match', async () => {
    mockFs();
    mockActiveModel(undefined);
    const { findModel } = await import('../../src/infra/models.js');

    expect(findModel('model-x@provider-b')?.provider).toBe('provider-b');
  });

  it('falls back to the first bare-name match when no exact id matches', async () => {
    mockFs();
    mockActiveModel(undefined);
    const { findModel } = await import('../../src/infra/models.js');

    expect(findModel('model-x')?.id).toBe('model-x@provider-a');
    expect(findModel('Model Y')?.id).toBe('model-y@provider-a');
    expect(findModel('nope')).toBeNull();
  });

  it('reports the configured context window, falling back to the default', async () => {
    mockFs();
    mockActiveModel(undefined);
    const { contextWindowOf } = await import('../../src/infra/models.js');

    expect(contextWindowOf('model-x@provider-a')).toBe(32000);
    expect(contextWindowOf('model-y@provider-a')).toBe(128000);
  });
});

describe('activeModel - config priority', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves the configured activeModel to a catalog entry', async () => {
    mockFs();
    mockActiveModel({ model: 'model-y', apiKeyEnv: 'API_KEY_A' });
    const { activeModelId } = await import('../../src/infra/models.js');

    expect(activeModelId()).toBe('model-y@provider-a');
  });

  it('returns an empty id when activeModel is not set in config', async () => {
    mockFs();
    mockActiveModel(undefined);
    const { activeModelId } = await import('../../src/infra/models.js');

    expect(activeModelId()).toBe('');
  });

  it('returns an empty id when activeModel matches no catalog entry', async () => {
    mockFs();
    mockActiveModel({ model: 'nonexistent', apiKeyEnv: 'UNKNOWN_KEY' });
    const { activeModelId } = await import('../../src/infra/models.js');

    expect(activeModelId()).toBe('');
  });
});

describe('setGlobalActive - persists to config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('writes model and api_key_env through updateActiveModel', async () => {
    const updateActiveModel = vi.fn();
    mockFs();
    mockActiveModel({ model: 'model-x', apiKeyEnv: 'API_KEY_A' }, { updateActiveModel });
    const { setGlobalActive } = await import('../../src/infra/models.js');

    setGlobalActive('model-y@provider-a');

    expect(updateActiveModel).toHaveBeenCalledWith('model-y', 'API_KEY_A');
  });

  it('throws CONFIG_INVALID and does not touch config when the id is unknown', async () => {
    const updateActiveModel = vi.fn();
    mockFs();
    mockActiveModel({ model: 'model-x', apiKeyEnv: 'API_KEY_A' }, { updateActiveModel });
    const { setGlobalActive } = await import('../../src/infra/models.js');

    expect(() => setGlobalActive('nonexistent@provider-a')).toThrow(/not found/);
    expect(updateActiveModel).not.toHaveBeenCalled();
  });
});

describe('LlmLayer.completeStream - model resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (process.env as any).API_KEY_A;
    delete (process.env as any).OPENAI_API_KEY;
  });

  afterEach(() => {
    delete (process.env as any).API_KEY_A;
    delete (process.env as any).OPENAI_API_KEY;
  });

  it('fails with CONFIG_INVALID when the requested model is not in the catalog', async () => {
    mockFs();
    mockActiveModel({ model: 'model-x', apiKeyEnv: 'API_KEY_A' });

    const result = await streamOnce('nonexistent@provider-a');

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect((result.left as any).code).toBe('CONFIG_INVALID');
      expect(result.left.message).toContain('nonexistent@provider-a');
    }
  });

  it('falls back to the configured activeModel when the requested model is empty', async () => {
    mockFs();
    mockActiveModel({ model: 'model-x', apiKeyEnv: 'API_KEY_A' });

    const result = await streamOnce('');

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      // 已经越过模型解析，卡在缺 API key 这一步
      expect((result.left as any).code).toBe('CONFIG_MISSING');
      expect(result.left.message).toContain('API_KEY_A');
    }
  });

  it('fails with CONFIG_INVALID when no activeModel is configured', async () => {
    mockFs();
    mockActiveModel(undefined);

    const result = await streamOnce('');

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect((result.left as any).code).toBe('CONFIG_INVALID');
      expect(result.left.message).toContain('activeModel');
    }
  });
});
