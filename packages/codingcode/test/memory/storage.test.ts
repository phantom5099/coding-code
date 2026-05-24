import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveProjectMemoryPath,
  resolveUserMemoryPath,
  readMemoryFile,
  extractAutoBlock,
  replaceAutoBlock,
  enforceMaxBytes,
  mergeAutoBlocks,
  writeMemoryFileAtomic,
  stripMarkersForPrompt,
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

describe('Path Resolution', () => {
  it('resolves project memory path - relative', () => {
    const cfg = { projectFile: '.codingcode/memory.md' } as any;
    const result = resolveProjectMemoryPath(tmpDir, cfg);
    expect(result).toBe(path.join(tmpDir, '.codingcode/memory.md'));
  });

  it('resolves project memory path - absolute', () => {
    const absPath = path.join(tmpDir, 'absolute.md');
    const cfg = { projectFile: absPath } as any;
    const result = resolveProjectMemoryPath(tmpDir, cfg);
    expect(result).toBe(absPath);
  });

  it('resolves user memory path - tilde expansion', () => {
    const cfg = { userFile: '~/.codingcode/memory.md' } as any;
    const result = resolveUserMemoryPath(cfg);
    expect(result).toBe(path.join(os.homedir(), '.codingcode/memory.md'));
  });

  it('resolves user memory path - absolute', () => {
    const absPath = path.join(tmpDir, 'user.md');
    const cfg = { userFile: absPath } as any;
    const result = resolveUserMemoryPath(cfg);
    expect(result).toBe(absPath);
  });
});

describe('File Operations', () => {
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

  it('extracts auto block', () => {
    const content = `Some text
<!-- auto:begin -->
### user
- Item 1
<!-- auto:end -->
More text`;
    const result = extractAutoBlock(content);
    expect(result).toContain('### user');
    expect(result).toContain('- Item 1');
    expect(result).not.toContain('<!-- auto:begin -->');
  });

  it('extracts empty auto block when markers absent', () => {
    const content = 'No markers here';
    const result = extractAutoBlock(content);
    expect(result).toBe('');
  });

  it('replaces auto block in existing content', () => {
    const content = `Before
<!-- auto:begin -->
Old content
<!-- auto:end -->
After`;
    const newAuto = '### new\n- content';
    const result = replaceAutoBlock(content, newAuto);
    expect(result).toContain('Before');
    expect(result).toContain('After');
    expect(result).toContain(newAuto);
    expect(result).not.toContain('Old content');
  });

  it('creates auto block when markers absent', () => {
    const content = 'Just text';
    const newAuto = '### user\n- item';
    const result = replaceAutoBlock(content, newAuto);
    expect(result).toContain('<!-- auto:begin -->');
    expect(result).toContain('<!-- auto:end -->');
    expect(result).toContain(newAuto);
  });

  it('strips markers for prompt injection', () => {
    const content = `<!-- auto:begin -->
### user
- Item 1
<!-- auto:end -->`;
    const result = stripMarkersForPrompt(content);
    expect(result).not.toContain('<!-- auto:begin -->');
    expect(result).not.toContain('<!-- auto:end -->');
    expect(result).toContain('### user');
  });
});

describe('enforceMaxBytes', () => {
  it('returns content unchanged if under limit', () => {
    const content = '### user\n- Item 1';
    const result = enforceMaxBytes(content, 1000);
    expect(result).toBe(content);
  });

  it('truncates content by dropping H3 sections from oldest', () => {
    const content = `### user
- Very long content here ${' x'.repeat(100)}

### project
- Another section ${' y'.repeat(100)}

### reference
- Third section`;
    const result = enforceMaxBytes(content, 200);
    // Should drop oldest sections first
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

describe('mergeAutoBlocks', () => {
  it('merges H3 sections with incoming overriding base', () => {
    const base = `### user
- Old role

### project
- Existing decision`;
    const incoming = `### user
- New role

### reference
- New resource`;
    const result = mergeAutoBlocks(base, incoming);
    expect(result).toContain('### user');
    expect(result).toContain('- New role');
    expect(result).toContain('### project');
    expect(result).toContain('- Existing decision');
    expect(result).toContain('### reference');
    expect(result).toContain('- New resource');
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
