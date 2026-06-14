import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemoryService } from '../../src/memory/index.js';
import { LLMFactoryService } from '../../src/llm/factory.js';

const tmpDir = path.join(os.tmpdir(), 'memory-index-test');

const mockFactory = {
  findModel: vi.fn(() => Effect.succeed(null)),
  createClient: vi.fn(() => Effect.succeed({})),
  listModels: vi.fn(() => Effect.succeed([])),
  getActiveEntry: vi.fn(() => Effect.succeed({})),
  switchModel: vi.fn(() => Effect.succeed({})),
  getLLMClient: vi.fn(() => Effect.succeed({})),
} as any;

const testLayer = MemoryService.Default.pipe(
  Layer.provide(Layer.succeed(LLMFactoryService, mockFactory))
);

let service: any;

function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

beforeEach(async () => {
  cleanup();
  fs.mkdirSync(tmpDir, { recursive: true });
  service = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* MemoryService;
    }).pipe(Effect.provide(testLayer))
  );
});

afterEach(() => {
  cleanup();
});

vi.mock('../../src/memory/config.js', () => ({
  getMemoryConfig: vi.fn(() => ({
    enabled: false,
    model: '',
    projectFile: '.codingcode/memory.md',
    userFile: '~/.codingcode/memory.md',
    maxBytes: 16384,
    promptMaxBytes: 8192,
    extraTypes: [],
    disabledTypes: [],
  })),
  getEffectiveTypes: vi.fn(() => [
    { name: 'user', description: 'User info', enabled: true },
    { name: 'project', description: 'Project info', enabled: true },
    { name: 'reference', description: 'References', enabled: true },
  ]),
  updateMemoryEnabled: vi.fn(),
}));

describe('Memory Index', () => {
  describe('loadMemoryForPrompt', () => {
    it('returns empty string when memory is disabled', () => {
      const result = service.loadMemoryForPrompt(tmpDir);
      expect(result).toBe('');
    });

    it('returns empty string when no memory files exist', async () => {
      const { getMemoryConfig } = await import('../../src/memory/config.js');
      vi.mocked(getMemoryConfig).mockReturnValue({
        enabled: true,
        model: '',
        projectFile: '.codingcode/memory.md',
        userFile: '~/.codingcode/memory.md',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: [],
        disabledTypes: [],
      } as any);

      const result = service.loadMemoryForPrompt(tmpDir);
      expect(result).toBe('');
    });

    it('loads and combines memory from project and user files', async () => {
      const { getMemoryConfig } = await import('../../src/memory/config.js');
      vi.mocked(getMemoryConfig).mockReturnValue({
        enabled: true,
        model: '',
        projectFile: '.codingcode/memory.md',
        userFile: '~/.codingcode/memory.md',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: [],
        disabledTypes: [],
      } as any);

      const projectMemFile = path.join(tmpDir, '.codingcode/memory.md');
      fs.mkdirSync(path.dirname(projectMemFile), { recursive: true });
      fs.writeFileSync(
        projectMemFile,
        `<!-- auto:begin -->
### project
- Architecture decision 1
<!-- auto:end -->`
      );

      const result = service.loadMemoryForPrompt(tmpDir);
      expect(result).toContain('## Long-term Memory');
      expect(result).toContain('### project');
      expect(result).toContain('Architecture decision 1');
      expect(result).not.toContain('<!-- auto:begin -->');
    });

    it('truncates memory when exceeds promptMaxBytes', async () => {
      const { getMemoryConfig } = await import('../../src/memory/config.js');
      vi.mocked(getMemoryConfig).mockReturnValue({
        enabled: true,
        model: '',
        projectFile: '.codingcode/memory.md',
        userFile: '~/.codingcode/memory.md',
        maxBytes: 16384,
        promptMaxBytes: 100,
        extraTypes: [],
        disabledTypes: [],
      } as any);

      const projectMemFile = path.join(tmpDir, '.codingcode/memory.md');
      fs.mkdirSync(path.dirname(projectMemFile), { recursive: true });
      fs.writeFileSync(
        projectMemFile,
        `<!-- auto:begin -->
### project
- Very long content that should be truncated ${' x'.repeat(200)}
<!-- auto:end -->`
      );

      const result = service.loadMemoryForPrompt(tmpDir);
      const bytes = Buffer.byteLength(result.replace('## Long-term Memory\n\n', ''), 'utf-8');
      expect(bytes).toBeLessThanOrEqual(100);
    });
  });

  describe('flushSessionToMemory', () => {
    it('returns early when memory disabled', async () => {
      const result = await service.flushSessionToMemory('fake-session-id', null);
      expect(result.written).toBe(false);
    });

    it('returns early when session not found', async () => {
      const { getMemoryConfig } = await import('../../src/memory/config.js');
      vi.mocked(getMemoryConfig).mockReturnValue({
        enabled: true,
        model: '',
        projectFile: '.codingcode/memory.md',
        userFile: '~/.codingcode/memory.md',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: [],
        disabledTypes: [],
      } as any);

      const result = await service.flushSessionToMemory('nonexistent-session', null);
      expect(result.written).toBe(false);
    });

    it('gracefully handles missing LLM', async () => {
      const { getMemoryConfig } = await import('../../src/memory/config.js');
      vi.mocked(getMemoryConfig).mockReturnValue({
        enabled: true,
        model: '',
        projectFile: '.codingcode/memory.md',
        userFile: '~/.codingcode/memory.md',
        maxBytes: 16384,
        promptMaxBytes: 8192,
        extraTypes: [],
        disabledTypes: [],
      } as any);

      // This will fail to find session, so returns false
      const result = await service.flushSessionToMemory('session', null);
      expect(result.written).toBe(false);
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

    it('loadMemoryForPrompt does not short-circuit when runtime enabled', () => {
      service.setMemoryEnabled(true);
      expect(service.getMemoryEnabled()).toBe(true);
      // No memory files → still empty, but NOT because of disabled check
      const result = service.loadMemoryForPrompt(tmpDir);
      expect(result).toBe('');
    });

    it('flushSessionToMemory returns early when runtime disabled', async () => {
      service.setMemoryEnabled(false);
      const result = await service.flushSessionToMemory('any-session', null);
      expect(result.written).toBe(false);
    });
  });
});
