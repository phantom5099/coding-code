import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { bashTool } from '@codingcode/bash';
import { testSandboxPolicy } from '../../../helpers/sandbox.js';

describe('tools/domains/bash projectPath isolation', () => {
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    globalDir = join(tmpdir(), `global-${randomUUID().slice(0, 8)}`);
    projectDir = join(tmpdir(), `project-${randomUUID().slice(0, 8)}`);
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(globalDir, 'config'), { recursive: true });
    writeFileSync(
      join(globalDir, 'config', 'models.json'),
      '{"active":"p","providers":[]}',
      'utf8'
    );
  });

  afterEach(() => {
    try {
      rmSync(globalDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const ctx = (cwd: string) => ({
    session: { cwd, sessionId: 'test-sid' },
    model: 'test-model',
    sandboxPolicy: testSandboxPolicy(cwd),
  });

  it('executes command in ctx.projectPath when cwd arg is absent', async () => {
    const cmd = 'echo hello > test-bash.txt';

    await Effect.runPromise(bashTool.execute({ command: cmd, timeout_ms: 10000 }, ctx(projectDir)));

    // Verify the file was written to projectDir, not globalDir
    expect(() => readFileSync(join(projectDir, 'test-bash.txt'), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(globalDir, 'test-bash.txt'), 'utf8')).toThrow();
    expect(readFileSync(join(projectDir, 'test-bash.txt'), 'utf8').trim()).toBe('hello');
  }, 15000);

  it('falls back to process.cwd() when ctx.projectPath is absent and cwd arg is absent', async () => {
    const cmd = 'echo fallback > test-fallback.txt';

    try {
      await Effect.runPromise(
        bashTool.execute({ command: cmd, timeout_ms: 10000 }, ctx(process.cwd())) as any
      );

      const cwd = process.cwd();
      expect(() => readFileSync(join(cwd, 'test-fallback.txt'), 'utf8')).not.toThrow();
      expect(readFileSync(join(cwd, 'test-fallback.txt'), 'utf8').trim()).toBe('fallback');
    } finally {
      try {
        rmSync(join(process.cwd(), 'test-fallback.txt'), { force: true });
      } catch {
        /* ignore */
      }
    }
  }, 15000);

  it('respects explicit cwd arg over ctx.projectPath', async () => {
    const otherDir = join(tmpdir(), `other-${randomUUID().slice(0, 8)}`);
    mkdirSync(otherDir, { recursive: true });
    try {
      const cmd = 'echo other > test-other.txt';

      await Effect.runPromise(
        bashTool.execute({ command: cmd, cwd: otherDir, timeout_ms: 10000 }, ctx(projectDir))
      );

      expect(() => readFileSync(join(otherDir, 'test-other.txt'), 'utf8')).not.toThrow();
      expect(() => readFileSync(join(projectDir, 'test-other.txt'), 'utf8')).toThrow();
    } finally {
      try {
        rmSync(otherDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }, 15000);
});
