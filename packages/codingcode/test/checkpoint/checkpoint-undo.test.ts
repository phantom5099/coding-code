import { describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readFileSync as fsReadFileSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { Effect, Layer } from 'effect';

const PROJECT_BASE = join(homedir(), '.codingcode', 'project');

function setupTempRepo(): { projectPath: string; slug: string } {
  const slug = `test-${randomUUID()}`;
  const projectPath = join(homedir(), '.codingcode-test', slug);
  mkdirSync(projectPath, { recursive: true });

  spawnSync('git', ['init'], { cwd: projectPath, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: projectPath, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: projectPath,
    encoding: 'utf-8',
  });

  return { projectPath, slug };
}

function cleanupTempRepo(projectPath: string) {
  rmSync(projectPath, { recursive: true, force: true });
}

function writeFile(projectPath: string, filename: string, content: string) {
  const filePath = join(projectPath, filename);
  const dir = join(filePath, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

describe('toGitPath case-insensitive matching', () => {
  it('handles Windows case-mismatched projectPath and file path', async () => {
    const { toGitPath } = await import('../../src/checkpoint/checkpoint-service.js');

    // projectPath has mixed case (Users, Desktop), file path is all lowercase
    const projectPath = 'c:/Users/Alice/Desktop/MyProject';
    const filePath = 'c:/users/alice/desktop/myproject/src/file.ts';
    const result = toGitPath(projectPath, filePath);

    expect(result).toBe('src/file.ts');
  });

  it('handles lowercase projectPath with uppercase file path', async () => {
    const { toGitPath } = await import('../../src/checkpoint/checkpoint-service.js');

    const projectPath = 'c:/users/alice/desktop/myproject';
    const filePath = 'c:/Users/Alice/Desktop/MyProject/src/file.ts';
    const result = toGitPath(projectPath, filePath);

    expect(result).toBe('src/file.ts');
  });

  it('still returns normalized absolute path when file is outside project', async () => {
    const { toGitPath } = await import('../../src/checkpoint/checkpoint-service.js');

    const result = toGitPath('c:/Users/Alice/Desktop/MyProject', 'c:/other/file.ts');

    expect(result).toContain('other/file.ts');
  });
});

describe('findCommitByMessage single-match guarantee', () => {
  it('returns only one hash even when multiple commits share a substring', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');

    const { projectPath } = setupTempRepo();

    try {
      writeFile(projectPath, 'a.txt', 'v1');

      const sg = new ShadowGit(projectPath);
      sg.init();

      // Commit with a message that shares a common prefix with another
      sg.commit('turn-abc123-1-baseline hello');
      writeFile(projectPath, 'a.txt', 'v2');
      sg.commit('turn-abc123-1-baseline world');

      // Both messages contain 'turn-abc123-1-baseline' as substring
      const hash = sg.findCommitByMessage('turn-abc123-1-baseline');

      expect(hash).not.toBeNull();
      // Must be a single 40-char hex hash, not multi-line
      expect(hash).toMatch(/^[a-f0-9]{40}$/);
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);
});

describe('checkoutFiles error propagation', () => {
  it('throws when restore receives an invalid commit hash', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');

    const { projectPath } = setupTempRepo();

    try {
      writeFile(projectPath, 'a.txt', 'content');

      const sg = new ShadowGit(projectPath);
      sg.init();
      sg.commit('baseline');

      // Invalid commit hash (multi-line or non-existent)
      const invalidCommit =
        'deadbeef00000000000000000000000000000000\n0000000000000000000000000000000000000000';

      expect(() => sg.checkoutFiles(invalidCommit, ['a.txt'])).toThrow('ShadowGit restore failed');
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);
});

describe('undoLastCodeRollback end-to-end via ShadowGit', () => {
  it('restores files from safety commit after revert and undo', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');
    const { createHash } = await import('crypto');
    const { dirname, join: pathJoin } = await import('path');

    const { projectPath } = setupTempRepo();

    try {
      // Setup: create a file, commit baseline, modify, commit final
      writeFile(projectPath, 'src/main.ts', 'console.log("baseline")');
      const sg = new ShadowGit(projectPath);
      sg.init();
      const baselineHash = sg.commit('turn-sess-1-baseline');

      writeFile(projectPath, 'src/main.ts', 'console.log("final")');
      const finalHash = sg.commit('turn-sess-1-final');

      expect(baselineHash).not.toBeNull();
      expect(finalHash).not.toBeNull();
      expect(baselineHash).not.toBe(finalHash);

      // Simulate revert: save current state as safety, checkout to baseline
      const safetyHash = sg.commit('turn-sess-1-revert-safety');
      sg.checkoutFiles(baselineHash, [join(projectPath, 'src/main.ts')]);

      // Verify reverted state
      expect(fsReadFileSync(join(projectPath, 'src/main.ts'), 'utf8')).toBe(
        'console.log("baseline")'
      );

      // Write restore entry manually (mimicking checkpoint-service internal format)
      const sessionId = 'sess';
      const shortSid = createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
      const restorePath = pathJoin(dirname(sg.gitDir), `last-restore-${shortSid}.json`);
      const entry = {
        id: 'test123',
        sessionId,
        action: 'checkpoint-file',
        throughTurnId: 1,
        baseTurnId: 1,
        affectedTurns: [],
        selectedFiles: [join(projectPath, 'src/main.ts')],
        safetyCommit: safetyHash,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(restorePath, JSON.stringify(entry, null, 2), 'utf8');

      // Read back and simulate undo: checkout from safety commit
      const storedEntry = JSON.parse(fsReadFileSync(restorePath, 'utf8'));
      expect(storedEntry).not.toBeNull();
      expect(storedEntry.safetyCommit).toBe(safetyHash);
      sg.checkoutFiles(storedEntry.safetyCommit, storedEntry.selectedFiles);

      // Verify restored to final state
      expect(fsReadFileSync(join(projectPath, 'src/main.ts'), 'utf8')).toBe('console.log("final")');
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);
});

describe('rollbackCodeToTurn uses inclusive target turn', () => {
  async function makeCheckpointLayer() {
    const { CheckpointService } = await import('../../src/checkpoint/checkpoint-service.js');
    const { HookService } = await import('../../src/hooks/registry.js');

    const mockHookLayer = Layer.succeed(HookService, {
      register: () => Effect.succeed(() => {}),
      emit: () => Effect.succeed(undefined),
      emitDecision: () => Effect.succeed(null),
      reloadUserHooks: () => Effect.void,
      registerDecision: () => Effect.succeed(() => {}),
    } as any);

    return CheckpointService.Default.pipe(Layer.provide(mockHookLayer));
  }

  it('previews the first turn diff when rolling back a single-turn session', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');
    const { CheckpointService } = await import('../../src/checkpoint/checkpoint-service.js');
    const { createHash } = await import('crypto');
    const checkpointLayer = await makeCheckpointLayer();
    const { projectPath } = setupTempRepo();

    try {
      const sessionId = 'sess-single-preview';
      const shortSid = createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
      const sg = new ShadowGit(projectPath);
      sg.init();
      sg.commit(`turn-${shortSid}-1-baseline`);
      writeFile(projectPath, 'articles/one.md', '# one');
      sg.commit(`turn-${shortSid}-1-final`);

      const preview = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.previewRollbackDiff(projectPath, sessionId, 1);
        }).pipe(Effect.provide(checkpointLayer))
      );

      expect(preview.baseTurnId).toBe(1);
      expect(preview.affectedTurns).toEqual([1]);
      expect(preview.diff).toContain('articles/one.md');
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);

  it('rolls back files created by the first turn in a single-turn session', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');
    const { CheckpointService } = await import('../../src/checkpoint/checkpoint-service.js');
    const { createHash } = await import('crypto');
    const checkpointLayer = await makeCheckpointLayer();
    const { projectPath } = setupTempRepo();

    try {
      const sessionId = 'sess-single-rollback';
      const shortSid = createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
      const sg = new ShadowGit(projectPath);
      sg.init();
      sg.commit(`turn-${shortSid}-1-baseline`);
      writeFile(projectPath, 'articles/one.md', '# one');
      sg.commit(`turn-${shortSid}-1-final`);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.rollbackCodeToTurn(projectPath, sessionId, 1);
        }).pipe(Effect.provide(checkpointLayer))
      );

      expect(result.reverted).toBe(true);
      expect(result.baseTurnId).toBe(1);
      expect(result.affectedTurns).toEqual([1]);
      expect(
        result.selectedFiles.some((f) => f.replace(/\\/g, '/').endsWith('articles/one.md'))
      ).toBe(true);
      expect(existsSync(join(projectPath, 'articles/one.md'))).toBe(false);
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);

  it('includes the target and later turns when rolling back a multi-turn session', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');
    const { CheckpointService } = await import('../../src/checkpoint/checkpoint-service.js');
    const { createHash } = await import('crypto');
    const checkpointLayer = await makeCheckpointLayer();
    const { projectPath } = setupTempRepo();

    try {
      const sessionId = 'sess-multi-rollback';
      const shortSid = createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
      const sg = new ShadowGit(projectPath);
      sg.init();

      writeFile(projectPath, 'one.txt', 'one');
      sg.commit(`turn-${shortSid}-1-baseline`);
      writeFile(projectPath, 'one.txt', 'one-final');
      sg.commit(`turn-${shortSid}-1-final`);

      sg.commit(`turn-${shortSid}-2-baseline`);
      writeFile(projectPath, 'two.txt', 'two-final');
      sg.commit(`turn-${shortSid}-2-final`);

      sg.commit(`turn-${shortSid}-3-baseline`);
      writeFile(projectPath, 'three.txt', 'three-final');
      sg.commit(`turn-${shortSid}-3-final`);

      const preview = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.previewRollbackDiff(projectPath, sessionId, 2);
        }).pipe(Effect.provide(checkpointLayer))
      );

      expect(preview.baseTurnId).toBe(2);
      expect(preview.affectedTurns).toEqual([2, 3]);
      expect(preview.diff).toContain('two.txt');
      expect(preview.diff).toContain('three.txt');
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);
});

describe('toGitPath preserves original casing for git paths', () => {
  it('returns relative path with original casing from git diff', async () => {
    const { toGitPath } = await import('../../src/checkpoint/checkpoint-service.js');

    // Simulate a path that git returns with original casing
    const projectPath = 'c:/Users/Alice/Desktop/MyProject';
    const gitPath = 'c:/Users/Alice/Desktop/MyProject/src/Main.ts';

    expect(toGitPath(projectPath, gitPath)).toBe('src/Main.ts');
  });
});

describe('undoLastCodeRollback case-insensitive path matching', () => {
  it('restores file when opts.files casing differs from entry.selectedFiles', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');
    const { createHash } = await import('crypto');
    const { dirname, join: pathJoin } = await import('path');
    const { CheckpointService } = await import('../../src/checkpoint/checkpoint-service.js');
    const { HookService } = await import('../../src/hooks/registry.js');

    const mockHookLayer = Layer.succeed(HookService, {
      register: () => Effect.succeed(() => {}),
      emit: () => Effect.succeed(undefined),
      emitDecision: () => Effect.succeed(null),
      reloadUserHooks: () => Effect.void,
      registerDecision: () => Effect.succeed(() => {}),
    } as any);

    const checkpointLayer = CheckpointService.Default.pipe(Layer.provide(mockHookLayer));

    const { projectPath } = setupTempRepo();

    try {
      writeFile(projectPath, 'src/main.ts', 'console.log("baseline")');
      const sg = new ShadowGit(projectPath);
      sg.init();
      const shortSid = createHash('sha256').update('sess').digest('hex').slice(0, 8);
      const baselineHash = sg.commit(`turn-${shortSid}-1-baseline`);

      writeFile(projectPath, 'src/main.ts', 'console.log("final")');
      sg.commit(`turn-${shortSid}-1-final`);

      const safetyHash = sg.commit(`turn-${shortSid}-1-revert-safety`);
      sg.checkoutFiles(baselineHash, [join(projectPath, 'src/main.ts')]);

      // Verify reverted state
      expect(readFileSync(join(projectPath, 'src/main.ts'), 'utf8')).toBe(
        'console.log("baseline")'
      );

      // Write restore entry with lowercase path (simulating old data)
      const sessionId = 'sess';
      const restorePath = pathJoin(dirname(sg.gitDir), `last-restore-${shortSid}.json`);
      const entry = {
        id: 'test123',
        sessionId,
        action: 'checkpoint-file',
        throughTurnId: 1,
        baseTurnId: 1,
        affectedTurns: [],
        selectedFiles: [join(projectPath, 'src/main.ts').toLowerCase()],
        safetyCommit: safetyHash,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(restorePath, JSON.stringify(entry, null, 2), 'utf8');

      // Call undo with original casing (mixed case)
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.undoLastCodeRollback(projectPath, sessionId, {
            files: [join(projectPath, 'src/main.ts')],
          });
        }).pipe(Effect.provide(checkpointLayer))
      );

      expect(result.restored).toBe(true);
      expect(result.restoredFiles.length).toBeGreaterThan(0);

      // Verify restored to final state
      expect(readFileSync(join(projectPath, 'src/main.ts'), 'utf8')).toBe('console.log("final")');
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);
});

describe('revertFilesImpl case-insensitive deduplication', () => {
  it('merges existing entry without duplicate paths when casing differs', async () => {
    const { ShadowGit } = await import('../../src/checkpoint/shadow-git.js');
    const { createHash } = await import('crypto');
    const { dirname, join: pathJoin } = await import('path');
    const { CheckpointService } = await import('../../src/checkpoint/checkpoint-service.js');
    const { HookService } = await import('../../src/hooks/registry.js');

    const mockHookLayer = Layer.succeed(HookService, {
      register: () => Effect.succeed(() => {}),
      emit: () => Effect.succeed(undefined),
      emitDecision: () => Effect.succeed(null),
      reloadUserHooks: () => Effect.void,
      registerDecision: () => Effect.succeed(() => {}),
    } as any);

    const checkpointLayer = CheckpointService.Default.pipe(Layer.provide(mockHookLayer));

    const { projectPath } = setupTempRepo();

    try {
      writeFile(projectPath, 'src/main.ts', 'console.log("baseline")');
      const sg = new ShadowGit(projectPath);
      sg.init();
      const shortSid = createHash('sha256').update('sess').digest('hex').slice(0, 8);
      const baselineHash = sg.commit(`turn-${shortSid}-1-baseline`);

      writeFile(projectPath, 'src/main.ts', 'console.log("final")');
      sg.commit(`turn-${shortSid}-1-final`);

      const filePath = join(projectPath, 'src/main.ts');

      // First revert with lowercase path
      const result1 = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.revertCheckpointFiles(projectPath, 'sess', 1, [filePath.toLowerCase()]);
        }).pipe(Effect.provide(checkpointLayer))
      );

      expect(result1.reverted).toBe(true);
      expect(result1.restoreEntry).not.toBeNull();
      expect(result1.restoreEntry!.selectedFiles.length).toBe(1);

      // Second revert with original casing (simulating different path source)
      const result2 = await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return checkpoint.revertCheckpointFiles(projectPath, 'sess', 1, [filePath]);
        }).pipe(Effect.provide(checkpointLayer))
      );

      expect(result2.reverted).toBe(true);
      expect(result2.restoreEntry).not.toBeNull();
      // Should still be 1 file, not 2, because casing difference is ignored
      expect(result2.restoreEntry!.selectedFiles.length).toBe(1);
    } finally {
      cleanupTempRepo(projectPath);
    }
  }, 15000);
});
