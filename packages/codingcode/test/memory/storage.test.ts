import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readMemoryFile,
  resolveMemoryPath,
  enforceMaxBytes,
  writeMemoryFileAtomic,
} from '../../src/memory/storage.js';

const tmpDir = path.join(os.tmpdir(), 'memory-test');

function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

beforeEach(() => {
  cleanup();
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  cleanup();
});

describe('resolveMemoryPath', () => {
  it('points to .codingcode/memory.md under cwd', () => {
    expect(resolveMemoryPath('/proj')).toBe(path.join('/proj', '.codingcode', 'memory.md'));
  });
});

describe('readMemoryFile', () => {
  it('reads non-existent file as empty string', () => {
    const result = readMemoryFile(path.join(tmpDir, 'nonexistent.md'));
    expect(result).toBe('');
  });

  it('reads existing file', () => {
    const file = path.join(tmpDir, 'test.md');
    const content = '# Test\nContent here';
    fs.writeFileSync(file, content);
    const result = readMemoryFile(file);
    expect(result).toBe(content);
  });
});

describe('writeMemoryFileAtomic', () => {
  it('writes file atomically', () => {
    const file = path.join(tmpDir, 'atomic.md');
    const content = 'Test content';
    writeMemoryFileAtomic(file, content);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe(content);
  });

  it('creates parent directories', () => {
    const file = path.join(tmpDir, 'deep/nested/dir/file.md');
    const content = 'Nested content';
    writeMemoryFileAtomic(file, content);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe(content);
  });
});

describe('enforceMaxBytes', () => {
  it('returns content unchanged if under limit', () => {
    const content = '### 主题\n- Item 1';
    const result = enforceMaxBytes(content, 1000);
    expect(result).toBe(content);
  });

  it('drops H3 sections from the end until under limit', () => {
    const content = `### first
- ${'a'.repeat(100)}

### second
- ${'b'.repeat(100)}

### third
- ${'c'.repeat(100)}`;
    const result = enforceMaxBytes(content, 200);
    expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(200);
    expect(result).toContain('### first');
  });

  it('falls back to line truncation when a single H3 section exceeds limit', () => {
    const content = `### huge
- ${'x'.repeat(500)}`;
    const result = enforceMaxBytes(content, 100);
    expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(100);
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to line truncation when content has no H3 sections', () => {
    const content = `${'l'.repeat(50)}\n${'m'.repeat(200)}`;
    const result = enforceMaxBytes(content, 100);
    expect(Buffer.byteLength(result, 'utf-8')).toBeLessThanOrEqual(100);
  });
});
