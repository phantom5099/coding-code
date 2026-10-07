import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemoryService, type MemoryShape } from '../../src/memory/port.js';
import { LLMService } from '../../src/llm/port.js';
import { MemoryLayer } from '../../src/memory/memory.js';
import { AgentError } from '../../src/core/error.js';

const tmpDir = path.join(os.tmpdir(), 'memory-index-test');
const memFile = path.join(tmpDir, '.codingcode', 'memory.md');

const mockLlm = {
  complete: vi.fn(() => Effect.succeed({ content: '' })),
  completeStream: vi.fn(),
} as any;

const testLayer = MemoryLayer.pipe(Layer.provide(Layer.succeed(LLMService, mockLlm)));

let service: MemoryShape;

/** MemoryShape 现在返回 Effect，测试统一用 Effect.runPromise 驱动 */
const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff);

function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

function writeMemory(content: string) {
  fs.mkdirSync(path.dirname(memFile), { recursive: true });
  fs.writeFileSync(memFile, content);
}

vi.mock('../../src/memory/config.js', () => ({
  getMemoryConfig: vi.fn(() => ({
    enabled: false,
    model: '',
    promptMaxBytes: 8192,
  })),
}));

// setMemoryEnabled persists via the infra config store, which writes the real
// ~/.codingcode/config.yaml. Stub the writer so the suite never touches user config.
vi.mock('../../src/infra/config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    updateMemoryEnabled: vi.fn(),
  };
});

vi.mock('../../src/session/file-ops.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readTranscript: vi.fn(() => []),
  };
});

function setLlmResponse(response: string, beforeResolve?: () => void) {
  mockLlm.complete.mockImplementation((_req: unknown, _model: string) => {
    beforeResolve?.();
    return Effect.succeed({ content: response });
  });
}

const TEST_MODEL = 'demo-model@demo';

beforeEach(async () => {
  cleanup();
  fs.mkdirSync(tmpDir, { recursive: true });
  mockLlm.complete.mockReset();
  setLlmResponse('');
  const { getMemoryConfig } = await import('../../src/memory/config.js');
  vi.mocked(getMemoryConfig).mockReturnValue({
    enabled: false,
    model: '',
    promptMaxBytes: 8192,
  });
  const { readTranscript } = await import('../../src/session/file-ops.js');
  vi.mocked(readTranscript).mockImplementation(() => []);
  service = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* MemoryService;
    }).pipe(Effect.provide(testLayer))
  );
});

afterEach(() => {
  cleanup();
});

async function enableConfig() {
  const { getMemoryConfig } = await import('../../src/memory/config.js');
  vi.mocked(getMemoryConfig).mockReturnValue({
    enabled: true,
    model: '',
    promptMaxBytes: 8192,
  });
}

describe('loadMemoryForPrompt', () => {
  it('returns empty string when memory is disabled', async () => {
    const result = await run(service.loadMemoryForPrompt(tmpDir));
    expect(result).toBe('');
  });

  it('returns empty string when no memory file exists', async () => {
    await enableConfig();
    const result = await run(service.loadMemoryForPrompt(tmpDir));
    expect(result).toBe('');
  });

  it('loads whole memory file', async () => {
    await enableConfig();
    writeMemory('### project\n- Architecture decision 1');

    const result = await run(service.loadMemoryForPrompt(tmpDir));
    expect(result).toContain('## Long-term Memory');
    expect(result).toContain('### project');
    expect(result).toContain('Architecture decision 1');
  });

  it('truncates memory when exceeds promptMaxBytes', async () => {
    const { getMemoryConfig } = await import('../../src/memory/config.js');
    vi.mocked(getMemoryConfig).mockReturnValue({
      enabled: true,
      model: '',
      promptMaxBytes: 100,
    });
    writeMemory(`### project
- Very long content that should be truncated ${' x'.repeat(200)}`);

    const result = await run(service.loadMemoryForPrompt(tmpDir));
    const bytes = Buffer.byteLength(result.replace('## Long-term Memory\n\n', ''), 'utf-8');
    expect(bytes).toBeLessThanOrEqual(100);
  });
});

describe('flushSessionToMemory', () => {
  it('returns early when memory disabled', async () => {
    const result = await run(service.flushSessionToMemory('fake-session-id', TEST_MODEL, tmpDir));
    expect(result.written).toBe(false);
  });

  it('returns early when session has no events', async () => {
    await enableConfig();
    const result = await run(service.flushSessionToMemory('empty-session', TEST_MODEL, tmpDir));
    expect(result.written).toBe(false);
  });

  it('gracefully handles an LLM failure', async () => {
    await enableConfig();
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(() => [{ type: 'user', content: 'hello' }] as any);
    mockLlm.complete.mockImplementation(() =>
      Effect.fail(new AgentError('LLM_FAILED', 'llm unavailable'))
    );
    const result = await run(service.flushSessionToMemory('session', TEST_MODEL, tmpDir));
    expect(result.written).toBe(false);
  });

  it('replaces the whole memory file with extracted content', async () => {
    await enableConfig();
    writeMemory('### 旧主题\n- 旧内容');
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(
      () =>
        [
          { type: 'user', content: '记住新架构决策' },
          { type: 'assistant', content: '好的' },
        ] as any
    );
    setLlmResponse('### 项目\n- 新的架构决策');

    const result = await run(service.flushSessionToMemory('session', TEST_MODEL, tmpDir));

    expect(mockLlm.complete.mock.calls[0]?.[1]).toBe(TEST_MODEL);
    expect(result.written).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(fs.readFileSync(memFile, 'utf-8')).toBe('### 项目\n- 新的架构决策');
  });

  it('keeps file unchanged when the model returns blank output', async () => {
    await enableConfig();
    writeMemory('### 旧主题\n- 旧内容');
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(() => [{ type: 'user', content: 'hello' }] as any);
    setLlmResponse('');

    const result = await run(service.flushSessionToMemory('session', TEST_MODEL, tmpDir));

    expect(result.written).toBe(false);
    expect(fs.readFileSync(memFile, 'utf-8')).toBe('### 旧主题\n- 旧内容');
  });

  it('skips rewrite when extracted content equals current file', async () => {
    await enableConfig();
    writeMemory('### 主题\n- 不变的内容');
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(
      () => [{ type: 'user', content: '无新信息' }] as any
    );
    setLlmResponse('### 主题\n- 不变的内容');

    const result = await run(service.flushSessionToMemory('session', TEST_MODEL, tmpDir));

    expect(result.written).toBe(false);
  });

  it('does not overwrite a memory file manually edited during extraction', async () => {
    await enableConfig();
    writeMemory('### 旧主题\n- 旧内容');
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(() => [{ type: 'user', content: 'hello' }] as any);
    setLlmResponse('### 自动\n- 新记忆', () => {
      writeMemory('### 手动\n- 用户并发编辑');
    });

    const result = await run(service.flushSessionToMemory('session', TEST_MODEL, tmpDir));

    expect(result.written).toBe(false);
    expect(fs.readFileSync(memFile, 'utf-8')).toBe('### 手动\n- 用户并发编辑');
  });
});

describe('runtime memory toggle', () => {
  afterEach(async () => {
    await run(service.setMemoryEnabled(false));
  });

  it('setMemoryEnabled(true) makes getMemoryEnabled return true', async () => {
    await run(service.setMemoryEnabled(true));
    expect(await run(service.getMemoryEnabled())).toBe(true);
  });

  it('setMemoryEnabled(false) makes getMemoryEnabled return false', async () => {
    await run(service.setMemoryEnabled(false));
    expect(await run(service.getMemoryEnabled())).toBe(false);
  });

  it('toggle sequence works correctly', async () => {
    await run(service.setMemoryEnabled(true));
    expect(await run(service.getMemoryEnabled())).toBe(true);
    await run(service.setMemoryEnabled(false));
    expect(await run(service.getMemoryEnabled())).toBe(false);
  });

  it('loadMemoryForPrompt returns empty when runtime disabled', async () => {
    await run(service.setMemoryEnabled(false));
    const result = await run(service.loadMemoryForPrompt(tmpDir));
    expect(result).toBe('');
  });

  it('flushSessionToMemory returns early when runtime disabled', async () => {
    await run(service.setMemoryEnabled(false));
    const result = await run(service.flushSessionToMemory('any-session', TEST_MODEL, tmpDir));
    expect(result.written).toBe(false);
  });
});
