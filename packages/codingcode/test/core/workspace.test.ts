import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  parseWorkspaceArgs,
  initWorkspace,
  getWorkspaceCwd,
  getProcessRoot,
  resolveInWorkspace,
} from '../../src/core/workspace.js';
import { encodeProjectPath } from '../../src/core/path.js';

describe('core/workspace', () => {
  let installRoot: string;
  let otherDir: string;

  beforeEach(() => {
    installRoot = join(tmpdir(), `install-${randomUUID().slice(0, 8)}`);
    otherDir = join(tmpdir(), `ws-${randomUUID().slice(0, 8)}`);
    mkdirSync(installRoot, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    mkdirSync(join(installRoot, 'config'), { recursive: true });
    writeFileSync(
      join(installRoot, 'config', 'models.json'),
      '{"active":"p","providers":[]}',
      'utf8'
    );
  });

  afterEach(() => {
    try {
      rmSync(installRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(otherDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('parseWorkspaceArgs extracts --cwd and leaves other flags', () => {
    expect(parseWorkspaceArgs(['serve', '--cwd', otherDir])).toEqual({
      workspaceCwd: otherDir,
      args: ['serve'],
    });
    expect(parseWorkspaceArgs(['--cwd=' + otherDir, 'tui'])).toEqual({
      workspaceCwd: otherDir,
      args: ['tui'],
    });
  });

  it('initWorkspace separates install root and workspace cwd', () => {
    initWorkspace({ processRoot: installRoot, workspaceCwd: otherDir });
    expect(getProcessRoot()).toBe(installRoot);
    expect(getWorkspaceCwd()).toBe(otherDir);
    expect(encodeProjectPath(getWorkspaceCwd())).toBe(encodeProjectPath(otherDir));
  });

  it('resolveInWorkspace resolves relative paths against workspace', () => {
    initWorkspace({ processRoot: installRoot, workspaceCwd: otherDir });
    expect(resolveInWorkspace('src/a.ts')).toBe(join(otherDir, 'src/a.ts'));
  });

  it('throws when --cwd path does not exist', () => {
    expect(() =>
      initWorkspace({ processRoot: installRoot, workspaceCwd: join(tmpdir(), 'missing-' + randomUUID()) })
    ).toThrow(/does not exist/);
  });
});
