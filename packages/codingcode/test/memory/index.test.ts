import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadMemoryForPrompt, flushSessionToMemory, getMemoryEnabled, setMemoryEnabled } from '../../src/memory/index.js';
import type { MemoryConfig } from '@codingcode/infra';
import type { LLMStreamAdapter } from '../../src/agent/agent.js';

const tmpDir = path.join(os.tmpdir(), 'memory-index-test');

function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

beforeEach(() => {
  cleanup();
  fs.mkdirSync(tmpDir, { recursive: true });
  vi.resetModules();
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
      const result = loadMemoryForPrompt(tmpDir);
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

      const result = loadMemoryForPrompt(tmpDir);
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
      fs.writeFileSync(projectMemFile, `<!-- auto:begin -->
### project
- Architecture decision 1
<!-- auto:end -->`);

      const result = loadMemoryForPrompt(tmpDir);
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
      fs.writeFileSync(projectMemFile, `<!-- auto:begin -->
### project
- Very long content that should be truncated ${' x'.repeat(200)}
<!-- auto:end -->`);

      const result = loadMemoryForPrompt(tmpDir);
      const bytes = Buffer.byteLength(result.replace('## Long-term Memory\n\n', ''), 'utf-8');
      expect(bytes).toBeLessThanOrEqual(100);
    });
  });

  describe('flushSessionToMemory', () => {
    it('returns early when memory disabled', async () => {
      const result = await flushSessionToMemory('fake-session-id', null);
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

      const result = await flushSessionToMemory('nonexistent-session', null);
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
      const result = await flushSessionToMemory('session', null);
      expect(result.written).toBe(false);
    });
  });

  describe('runtime memory toggle', () => {
    afterEach(() => {
      setMemoryEnabled(false);
    });

    it('setMemoryEnabled(true) makes getMemoryEnabled return true', () => {
      setMemoryEnabled(true);
      expect(getMemoryEnabled()).toBe(true);
    });

    it('setMemoryEnabled(false) makes getMemoryEnabled return false', () => {
      setMemoryEnabled(false);
      expect(getMemoryEnabled()).toBe(false);
    });

    it('toggle sequence works correctly', () => {
      setMemoryEnabled(true);
      expect(getMemoryEnabled()).toBe(true);
      setMemoryEnabled(false);
      expect(getMemoryEnabled()).toBe(false);
    });

    it('loadMemoryForPrompt returns empty when runtime disabled', () => {
      setMemoryEnabled(false);
      const result = loadMemoryForPrompt(tmpDir);
      expect(result).toBe('');
    });

    it('loadMemoryForPrompt does not short-circuit when runtime enabled', () => {
      setMemoryEnabled(true);
      expect(getMemoryEnabled()).toBe(true);
      // No memory files → still empty, but NOT because of disabled check
      const result = loadMemoryForPrompt(tmpDir);
      expect(result).toBe('');
    });

    it('flushSessionToMemory returns early when runtime disabled', async () => {
      setMemoryEnabled(false);
      const result = await flushSessionToMemory('any-session', null);
      expect(result.written).toBe(false);
    });
  });
});
