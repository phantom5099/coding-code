import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { initWorkspace, getWorkspaceCwd } from '../../../../src/core/workspace.js';
import { bashTool } from '../../../../src/tools/domains/bash/exec.js';

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
    initWorkspace({ installRoot: globalDir, workspaceCwd: globalDir });
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

  const ctx = (cwd: string) => ({ projectPath: cwd });

  it('executes command in ctx.projectPath when cwd arg is absent', async () => {
    // On Windows, use PowerShell to write a file in the current directory
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `powershell -Command "'hello' | Out-File -Encoding utf8 test-bash.txt"`
      : `echo hello > test-bash.txt`;

    const result = await bashTool.execute({ command: cmd, timeout_ms: 10000 }, ctx(projectDir));

    // Verify the file was written to projectDir, not globalDir
    expect(() => readFileSync(join(projectDir, 'test-bash.txt'), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(globalDir, 'test-bash.txt'), 'utf8')).toThrow();
    expect(readFileSync(join(projectDir, 'test-bash.txt'), 'utf8').trim()).toBe('hello');
  });

  it('falls back to workspaceCwd when ctx.projectPath is absent and cwd arg is absent', async () => {
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `powershell -Command "'fallback' | Out-File -Encoding utf8 test-fallback.txt"`
      : `echo fallback > test-fallback.txt`;

    const result = await bashTool.execute({ command: cmd, timeout_ms: 10000 }, undefined);

    expect(() => readFileSync(join(globalDir, 'test-fallback.txt'), 'utf8')).not.toThrow();
    expect(readFileSync(join(globalDir, 'test-fallback.txt'), 'utf8').trim()).toBe('fallback');
  });

  it('respects explicit cwd arg over ctx.projectPath', async () => {
    const otherDir = join(tmpdir(), `other-${randomUUID().slice(0, 8)}`);
    mkdirSync(otherDir, { recursive: true });
    try {
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? `powershell -Command "'other' | Out-File -Encoding utf8 test-other.txt"`
        : `echo other > test-other.txt`;

      const result = await bashTool.execute(
        { command: cmd, cwd: otherDir, timeout_ms: 10000 },
        ctx(projectDir)
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
  });
});
