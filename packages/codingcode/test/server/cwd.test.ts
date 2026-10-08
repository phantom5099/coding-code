import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { isGlobalCwd, tempCwd, resolveCwd, resolveWorkspaceCwd } from '../../src/server/cwd.js';
import { AgentError } from '../../src/core/error.js';
import { statusOf } from '../../src/server/http-error.js';

describe('server/cwd：请求入口的工作区解析', () => {
  it('isGlobalCwd treats missing, empty and "global" as global', () => {
    expect(isGlobalCwd(undefined)).toBe(true);
    expect(isGlobalCwd('')).toBe(true);
    expect(isGlobalCwd('global')).toBe(true);
    expect(isGlobalCwd('/some/project')).toBe(false);
  });

  it('resolveCwd 绝对化请求路径、缺省回落共享 temp，且不校验存在性', () => {
    const otherDir = join(tmpdir(), 'cc-other');
    expect(resolveCwd(otherDir)).toBe(resolve(otherDir));
    expect(resolveCwd()).toBe(tempCwd());
    expect(resolveCwd('')).toBe(tempCwd());
    expect(tempCwd()).not.toBe(process.cwd());
  });

  it('resolveWorkspaceCwd：目录存在则通过；缺省/global 回落 temp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-cwd-'));
    try {
      expect(resolveWorkspaceCwd(dir)).toBe(resolve(dir));
      expect(resolveWorkspaceCwd()).toBe(tempCwd());
      expect(resolveWorkspaceCwd('global')).toBe(tempCwd());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveWorkspaceCwd：显式给出但目录不存在 → CONFIG_INVALID(400)', () => {
    const missing = join(tmpdir(), `cc-missing-${Date.now()}`);
    let caught: unknown;
    try {
      resolveWorkspaceCwd(missing);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AgentError);
    expect((caught as AgentError).code).toBe('CONFIG_INVALID');
    expect(statusOf(caught as AgentError)).toBe(400);
  });
});
