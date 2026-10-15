import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { CheckpointService } from '../../src/checkpoint/port.js';
import { CheckpointLayer } from '../../src/checkpoint/checkpoint.js';
import { ShadowGit } from '../../src/checkpoint/shadow-git.js';
import { normalizePath } from '../../src/util/path.js';
import { useTempProjectBase } from '../helpers/project-base.js';

useTempProjectBase();

interface DiffFile {
  path: string;
  status: string;
  diff: string;
  insertions: number;
  deletions: number;
}

/** 造一个项目：before.txt 已在 baseline 中，之后新建 after.txt 并修改 before.txt。
 *  sessionId 每用例唯一：baseline 幂等状态是模块级共享的，共用 sessionId 会串味。 */
function setupProject(): { projectPath: string; sessionId: string } {
  const projectPath = join(tmpdir(), `codingcode-${randomUUID()}`);
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, 'before.txt'), 'before\n', 'utf8');
  return { projectPath, sessionId: `staged-diff-${randomUUID()}` };
}

describe('staged diff（add 方案：新文件经 stageAll 进入 index）', () => {
  it('getCheckpointDiff 覆盖新文件（status A、完整内容）与已跟踪修改（status M、增量）', async () => {
    const { projectPath, sessionId } = setupProject();
    try {
      const result = (await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 1);
          writeFileSync(join(projectPath, 'after.txt'), 'after\n', 'utf8');
          writeFileSync(join(projectPath, 'before.txt'), 'before\nmodified\n', 'utf8');
          return yield* checkpoint.getCheckpointDiff(projectPath, sessionId);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      )) as { turnId: number; files: DiffFile[] };

      expect(result.turnId).toBe(1);
      const afterPath = normalizePath(join(projectPath, 'after.txt'));
      const beforePath = normalizePath(join(projectPath, 'before.txt'));

      const after = result.files.find((f) => f.path === afterPath)!;
      expect(after).toBeDefined();
      expect(after.status).toBe('A');
      expect(after.diff).toContain('+after');
      expect(after.insertions).toBe(1);
      expect(after.deletions).toBe(0);

      const before = result.files.find((f) => f.path === beforePath)!;
      expect(before).toBeDefined();
      expect(before.status).toBe('M');
      expect(before.diff).toContain('+modified');
      expect(before.insertions).toBe(1);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);

  it('rollbackCodeToTurn 删除新文件并还原已跟踪文件', async () => {
    const { projectPath, sessionId } = setupProject();
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 1);
          writeFileSync(join(projectPath, 'after.txt'), 'after\n', 'utf8');
          writeFileSync(join(projectPath, 'before.txt'), 'before\nmodified\n', 'utf8');
          return yield* checkpoint.rollbackCodeToTurn(projectPath, sessionId, 1);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      );

      expect(existsSync(join(projectPath, 'after.txt'))).toBe(false);
      expect(readFileSync(join(projectPath, 'before.txt'), 'utf8')).toBe('before\n');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);

  it('revertCheckpointFiles 只删选中的新文件，不影响其他文件', async () => {
    const { projectPath, sessionId } = setupProject();
    try {
      const result = (await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 1);
          writeFileSync(join(projectPath, 'after.txt'), 'after\n', 'utf8');
          writeFileSync(join(projectPath, 'before.txt'), 'before\nmodified\n', 'utf8');
          return yield* checkpoint.revertCheckpointFiles(projectPath, sessionId, 1, [
            join(projectPath, 'after.txt'),
          ]);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      )) as { reverted: boolean; throughTurnId: number; selectedFiles: string[] };

      expect(result.reverted).toBe(true);
      expect(existsSync(join(projectPath, 'after.txt'))).toBe(false);
      expect(readFileSync(join(projectPath, 'before.txt'), 'utf8')).toBe('before\nmodified\n');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);

  it('previewRollbackDiff 的 diff 覆盖新文件与已跟踪修改', async () => {
    const { projectPath, sessionId } = setupProject();
    try {
      const preview = (await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 1);
          writeFileSync(join(projectPath, 'after.txt'), 'after\n', 'utf8');
          writeFileSync(join(projectPath, 'before.txt'), 'before\nmodified\n', 'utf8');
          return yield* checkpoint.previewRollbackDiff(projectPath, sessionId, 1);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      )) as { throughTurnId: number; diff: string };

      expect(preview.throughTurnId).toBe(1);
      expect(preview.diff).toContain('after.txt');
      expect(preview.diff).toContain('+after');
      expect(preview.diff).toContain('+modified');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);

  it('回滚后的下一轮 baseline 正常提交，diff 归空', async () => {
    const { projectPath, sessionId } = setupProject();
    try {
      const result = (await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 1);
          writeFileSync(join(projectPath, 'after.txt'), 'after\n', 'utf8');
          yield* checkpoint.rollbackCodeToTurn(projectPath, sessionId, 1);
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 2);
          return yield* checkpoint.getCheckpointDiff(projectPath, sessionId);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      )) as { turnId: number; files: DiffFile[] };

      expect(result.turnId).toBe(2);
      expect(result.files).toEqual([]);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);

  it('回退 → 撤销回退 → 再回退，闭环可逆', async () => {
    const { projectPath, sessionId } = setupProject();
    const afterPath = join(projectPath, 'after.txt');
    const beforePath = join(projectPath, 'before.txt');
    try {
      const run = (files: string[], op: 'revert' | 'undo') =>
        Effect.runPromise(
          Effect.gen(function* () {
            const checkpoint = yield* CheckpointService;
            yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 1);
            writeFileSync(afterPath, 'agent\n', 'utf8');
            writeFileSync(beforePath, 'before\nagent\n', 'utf8');
            return op === 'revert'
              ? yield* checkpoint.revertCheckpointFiles(projectPath, sessionId, 1, files)
              : yield* checkpoint.undoRollback(projectPath, sessionId, 1, files);
          }).pipe(Effect.provide(CheckpointLayer) as any)
        ) as Promise<{ reverted: boolean }>;

      // 回退：恢复 baseline
      expect((await run([afterPath, beforePath], 'revert')).reverted).toBe(true);
      expect(existsSync(afterPath)).toBe(false);
      expect(readFileSync(beforePath, 'utf8')).toBe('before\n');

      // 撤销回退：恢复 agent 完成态
      expect((await run([afterPath, beforePath], 'undo')).reverted).toBe(true);
      expect(readFileSync(afterPath, 'utf8')).toBe('agent\n');
      expect(readFileSync(beforePath, 'utf8')).toBe('before\nagent\n');

      // 再回退：又回 baseline，可反复
      expect((await run([afterPath, beforePath], 'revert')).reverted).toBe(true);
      expect(existsSync(afterPath)).toBe(false);
      expect(readFileSync(beforePath, 'utf8')).toBe('before\n');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);

  it('回退后继续对话几轮再回退同一目标轮：组合唯一，undo 恢复到最近一次回退前', async () => {
    const { projectPath, sessionId } = setupProject();
    const afterPath = join(projectPath, 'after.txt');
    try {
      // 第 1 轮：agent 产出 v1
      await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 1);
          writeFileSync(afterPath, 'v1\n', 'utf8');
          return yield* checkpoint.revertCheckpointFiles(projectPath, sessionId, 1, [afterPath]);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      );
      expect(existsSync(afterPath)).toBe(false);

      // 第 2 轮（回退后继续对话）：agent 产出 v2
      await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 2);
          writeFileSync(afterPath, 'v2\n', 'utf8');
          // 又回退第 1 轮 → 新组合 (当前轮2, 目标轮1) 的快照，内容为 v2
          return yield* checkpoint.revertCheckpointFiles(projectPath, sessionId, 1, [afterPath]);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      );
      expect(existsSync(afterPath)).toBe(false);

      // 撤销：恢复到最近一次（v2）回退前的状态，而不是第一次的 v1
      await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          return yield* checkpoint.undoRollback(projectPath, sessionId, 1, [afterPath]);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      );
      expect(readFileSync(afterPath, 'utf8')).toBe('v2\n');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);

  it('没有快照时 undoRollback 返回 reverted:false', async () => {
    const { projectPath, sessionId } = setupProject();
    try {
      const result = (await Effect.runPromise(
        Effect.gen(function* () {
          const checkpoint = yield* CheckpointService;
          yield* checkpoint.snapshotBeforeWrite(projectPath, sessionId, 1);
          writeFileSync(join(projectPath, 'after.txt'), 'after\n', 'utf8');
          return yield* checkpoint.undoRollback(projectPath, sessionId, 1, [
            join(projectPath, 'after.txt'),
          ]);
        }).pipe(Effect.provide(CheckpointLayer) as any)
      )) as { reverted: boolean };

      expect(result.reverted).toBe(false);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);
});

describe('ShadowGit.isTooLargeForSnapshot（stageAll 后的新数据源）', () => {
  it('首个快照（无 HEAD）走 ls-files 全量分支，小项目不误报', async () => {
    const { projectPath } = setupProject();
    try {
      const sg = new ShadowGit(projectPath);
      sg.init();
      sg.stageAll();
      expect(sg.isTooLargeForSnapshot()).toBe(false);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);

  it('baseline 提交后 index 干净，diff --cached HEAD 为空不误报', async () => {
    const { projectPath, sessionId } = setupProject();
    try {
      const sg = new ShadowGit(projectPath);
      sg.init();
      sg.commit(`turn-${sessionId}-1-baseline`);
      sg.stageAll();
      expect(sg.isTooLargeForSnapshot()).toBe(false);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }, 60000);
});
