﻿import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { WorkspaceService, parseWorkspaceArgs } from '../../src/core/workspace.js';
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

  it('init separates install root and workspace cwd', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        ws.init({ processRoot: installRoot, workspaceCwd: otherDir });
        expect(ws.getProcessRoot()).toBe(installRoot);
        expect(ws.getWorkspaceCwd()).toBe(otherDir);
        expect(encodeProjectPath(ws.getWorkspaceCwd())).toBe(encodeProjectPath(otherDir));
      }).pipe(Effect.provide(WorkspaceService.Default))
    );
  });

  it('resolveInWorkspace resolves relative paths against workspace', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        ws.init({ processRoot: installRoot, workspaceCwd: otherDir });
        expect(ws.resolveInWorkspace('src/a.ts')).toBe(join(otherDir, 'src/a.ts'));
      }).pipe(Effect.provide(WorkspaceService.Default))
    );
  });

  it('throws when --cwd path does not exist', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const ws = yield* WorkspaceService;
        expect(() =>
          ws.init({ processRoot: installRoot, workspaceCwd: join(tmpdir(), 'missing-' + randomUUID()) })
        ).toThrow(/does not exist/);
      }).pipe(Effect.provide(WorkspaceService.Default))
    );
  });
});
