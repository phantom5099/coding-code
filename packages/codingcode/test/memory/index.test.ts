import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemoryService } from '../../src/memory/port.js';
import { LLMFactoryService } from '../../src/llm/port.js';
import { MemoryLayer } from '../../src/memory/memory.js';

const tmpDir = path.join(os.tmpdir(), 'memory-index-test');
const memFile = path.join(tmpDir, '.codingcode', 'memory.md');

const mockFactory = {
  findModel: vi.fn(() => Effect.succeed(null)),
  createClient: vi.fn(() => Effect.succeed({})),
  listModels: vi.fn(() => Effect.succeed([])),
  getActiveEntry: vi.fn(() => Effect.succeed({})),
  switchModel: vi.fn(() => Effect.succeed({})),
  getLLMClient: vi.fn(() => Effect.succeed({})),
} as any;

const testLayer = MemoryLayer.pipe(
  Layer.provide(Layer.succeed(LLMFactoryService, mockFactory))
);

let service: any;

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

vi.mock('../../src/session/file-ops.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readTranscript: vi.fn(() => []),
  };
});

function createMockLlm(response: string, beforeYield?: () => void) {
  return {
    complete: vi.fn(() => Effect.succeed({ content: response })),
    completeStream: vi.fn(() =>
      (async function* () {
        beforeYield?.();
        yield { type: 'text' as const, text: response };
        yield { type: 'end' as const };
      })()
    ),
    modelInfo: {
      provider: 'mock',
      model: 'mock',
      maxTokens: 4096,
      supportsToolCalling: true,
      supportsStreaming: true,
    },
  };
}

beforeEach(async () => {
  cleanup();
  fs.mkdirSync(tmpDir, { recursive: true });
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
  it('returns empty string when memory is disabled', () => {
    const result = service.loadMemoryForPrompt(tmpDir);
    expect(result).toBe('');
  });

  it('returns empty string when no memory file exists', async () => {
    await enableConfig();
    const result = service.loadMemoryForPrompt(tmpDir);
    expect(result).toBe('');
  });

  it('loads whole memory file', async () => {
    await enableConfig();
    writeMemory('### project\n- Architecture decision 1');

    const result = service.loadMemoryForPrompt(tmpDir);
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

    const result = service.loadMemoryForPrompt(tmpDir);
    const bytes = Buffer.byteLength(result.replace('## Long-term Memory\n\n', ''), 'utf-8');
    expect(bytes).toBeLessThanOrEqual(100);
  });
});

describe('flushSessionToMemory', () => {
  it('returns early when memory disabled', async () => {
    const result = await service.flushSessionToMemory('fake-session-id', null, tmpDir);
    expect(result.written).toBe(false);
  });

  it('returns early when session has no events', async () => {
    await enableConfig();
    const result = await service.flushSessionToMemory('empty-session', null, tmpDir);
    expect(result.written).toBe(false);
  });

  it('gracefully handles missing LLM', async () => {
    await enableConfig();
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(() => [
      { type: 'user', content: 'hello' },
    ] as any);
    const result = await service.flushSessionToMemory('session', null, tmpDir);
    expect(result.written).toBe(false);
  });

  it('replaces the whole memory file with extracted content', async () => {
    await enableConfig();
    writeMemory('### 旧主题\n- 旧内容');
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(() => [
      { type: 'user', content: '记住新架构决策' },
      { type: 'assistant', content: '好的' },
    ] as any);
    const llm = createMockLlm('<memory>### 项目\n- 新的架构决策</memory>');

    const result = await service.flushSessionToMemory('session', llm, tmpDir);

    expect(result.written).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(fs.readFileSync(memFile, 'utf-8')).toBe('### 项目\n- 新的架构决策');
  });

  it('keeps file unchanged when model returns empty memory', async () => {
    await enableConfig();
    writeMemory('### 旧主题\n- 旧内容');
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(() => [
      { type: 'user', content: 'hello' },
    ] as any);

    const result = await service.flushSessionToMemory('session', createMockLlm('<memory></memory>'), tmpDir);

    expect(result.written).toBe(false);
    expect(fs.readFileSync(memFile, 'utf-8')).toBe('### 旧主题\n- 旧内容');
  });

  it('skips rewrite when extracted content equals current file', async () => {
    await enableConfig();
    writeMemory('### 主题\n- 不变的内容');
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(() => [
      { type: 'user', content: '无新信息' },
    ] as any);

    const result = await service.flushSessionToMemory(
      'session',
      createMockLlm('<memory>### 主题\n- 不变的内容</memory>'),
      tmpDir
    );

    expect(result.written).toBe(false);
  });

  it('does not overwrite a memory file manually edited during extraction', async () => {
    await enableConfig();
    writeMemory('### 旧主题\n- 旧内容');
    const { readTranscript } = await import('../../src/session/file-ops.js');
    vi.mocked(readTranscript).mockImplementation(() => [
      { type: 'user', content: 'hello' },
    ] as any);
    const llm = createMockLlm('<memory>### 自动\n- 新记忆</memory>', () => {
      writeMemory('### 手动\n- 用户并发编辑');
    });

    const result = await service.flushSessionToMemory('session', llm, tmpDir);

    expect(result.written).toBe(false);
    expect(fs.readFileSync(memFile, 'utf-8')).toBe('### 手动\n- 用户并发编辑');
  });
});

describe('runtime memory toggle', () => {
  afterEach(() => {
    service.setMemoryEnabled(false);
  });

  it('setMemoryEnabled(true) makes getMemoryEnabled return true', () => {
    service.setMemoryEnabled(true);
    expect(service.getMemoryEnabled()).toBe(true);
  });

  it('setMemoryEnabled(false) makes getMemoryEnabled return false', () => {
    service.setMemoryEnabled(false);
    expect(service.getMemoryEnabled()).toBe(false);
  });

  it('toggle sequence works correctly', () => {
    service.setMemoryEnabled(true);
    expect(service.getMemoryEnabled()).toBe(true);
    service.setMemoryEnabled(false);
    expect(service.getMemoryEnabled()).toBe(false);
  });

  it('loadMemoryForPrompt returns empty when runtime disabled', () => {
    service.setMemoryEnabled(false);
    const result = service.loadMemoryForPrompt(tmpDir);
    expect(result).toBe('');
  });

  it('flushSessionToMemory returns early when runtime disabled', async () => {
    service.setMemoryEnabled(false);
    const result = await service.flushSessionToMemory('any-session', null, tmpDir);
    expect(result.written).toBe(false);
  });
});
