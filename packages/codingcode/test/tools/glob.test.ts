import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { globTool } from '../../src/tools/domains/fs/glob.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), 'coding-agent-glob-test-' + Date.now());

async function setup() {
  await mkdir(testDir, { recursive: true });
  await writeFile(join(testDir, 'a.ts'), '// a');
  await writeFile(join(testDir, 'b.ts'), '// b');
  await writeFile(join(testDir, 'c.test.ts'), '// c test');
  await writeFile(join(testDir, 'd.js'), '// d');
  await mkdir(join(testDir, 'subdir'));
  await writeFile(join(testDir, 'subdir', 'e.ts'), '// e');
}

async function cleanup() {
  await rm(testDir, { recursive: true, force: true });
}

describe('globTool', () => {
  it('should find files matching a simple pattern', async () => {
    await setup();
    const cwd = process.cwd;
    try {
      // Override cwd just for this test 鈥?globTool resolves relative to cwd,
      // but path param is resolved within execute to absolute path
      const result = await Effect.runPromise(
        globTool.execute({
          pattern: '*.ts',
          path: testDir,
          max_results: 50,
        })
      );
      expect(result).toContain('a.ts');
      expect(result).toContain('b.ts');
      expect(result).toContain('c.test.ts');
      expect(result).not.toContain('d.js');
      expect(result).not.toContain('subdir');
    } finally {
      await cleanup();
    }
  });

  it('should find files in subdirectories with **', async () => {
    await setup();
    try {
      const result = await Effect.runPromise(
        globTool.execute({
          pattern: '**/*.ts',
          path: testDir,
          max_results: 50,
        }) as any
      );
      expect(result).toContain('e.ts');
    } finally {
      await cleanup();
    }
  });

  it('should respect max_results', async () => {
    await setup();
    try {
      const result = await Effect.runPromise(
        globTool.execute({
          pattern: '*.ts',
          path: testDir,
          max_results: 1,
        }) as any
      );
      expect(result).toContain('showing first 1');
    } finally {
      await cleanup();
    }
  });

  it('should return no match message when nothing found', async () => {
    await setup();
    try {
      const result = await Effect.runPromise(
        globTool.execute({
          pattern: '*.py',
          path: testDir,
          max_results: 50,
        })
      );
      expect(result).toContain('No files matching');
    } finally {
      await cleanup();
    }
  });

  it('should fail on invalid path without crashing', async () => {
    const result = await Effect.runPromise(
      globTool.execute({
        pattern: '*.ts',
        path: '/nonexistent/path/xyz123',
        max_results: 50,
      }) as any
    );
    // Should not throw 鈥?globby returns empty array for nonexistent dirs
    expect(typeof result).toBe('string');
  });
});
