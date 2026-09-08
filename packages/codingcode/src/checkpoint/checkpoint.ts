import { Layer, Effect } from 'effect';
import { resolve } from 'path';
import { ShadowGit } from './shadow-git.js';
import { ProjectLock } from './project-lock.js';
import { normalizePath } from '../core/path.js';
import { commitMsg, toGitPath, ProjectCache } from './utils.js';
import { getCompletedTurnsFor, getTurnRestorePlan, getRollbackToTurnPlan } from './turn-query.js';
import { emptyRollbackResult, executeRollback } from './rollback-engine.js';
import { CheckpointService } from './port.js';

// ---- Effect Service ----

export const CheckpointLayer = Layer.effect(CheckpointService, Effect.gen(function* () {
    const shadowGitByProject = new ProjectCache<ShadowGit>(10);
    const lockByProject = new ProjectCache<ProjectLock>(10);

    function ensure(projectPath: string): ShadowGit {
      const normalized = normalizePath(projectPath);
      return shadowGitByProject.get(normalized, () => {
        const sg = new ShadowGit(normalized);
        sg.init();
        return sg;
      });
    }

    function lockFor(projectPath: string): ProjectLock {
      const normalized = normalizePath(projectPath);
      return lockByProject.get(normalized, () => new ProjectLock(normalized));
    }

    function doSnapshotFinal(sg: ShadowGit, sessionId: string, turnId: number): void {
      const lock = lockFor(sg.projectPath);
      lock.lock();
      try {
        sg.commit(commitMsg(sessionId, turnId, 'final'));
      } finally {
        lock.unlock();
      }
    }

    function repairIncompleteTurn(sg: ShadowGit, sessionId: string): void {
      const completed = getCompletedTurnsFor(sg, sessionId);
      const candidate = completed.length > 0 ? completed[completed.length - 1]! + 1 : 1;
      const baseline = sg.findCommitByMessage(commitMsg(sessionId, candidate, 'baseline'));
      if (!baseline) return;
      const final = sg.findCommitByMessage(commitMsg(sessionId, candidate, 'final'));
      if (final) return;
      doSnapshotFinal(sg, sessionId, candidate);
    }

    function latestCompletedTurn(sg: ShadowGit, sessionId: string): number {
      const completed = getCompletedTurnsFor(sg, sessionId);
      return completed.length > 0 ? completed[completed.length - 1]! : 0;
    }

    return {
      snapshotBaseline: (projectPath: string, sessionId: string, turnId: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          repairIncompleteTurn(sg, sessionId);
          if (sg.isTooLargeForSnapshot()) return;
          const lock = lockFor(projectPath);
          const msg = commitMsg(sessionId, turnId, 'baseline');
          lock.lock();
          try {
            sg.commit(msg);
          } finally {
            lock.unlock();
          }
        }),

      snapshotFinal: (projectPath: string, sessionId: string, turnId: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          if (sg.isTooLargeForSnapshot()) return;
          doSnapshotFinal(sg, sessionId, turnId);
        }),

      getCheckpointDiff: (projectPath: string, sessionId: string, turnId?: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          repairIncompleteTurn(sg, sessionId);
          const latestTurnId = turnId ?? latestCompletedTurn(sg, sessionId);
          if (latestTurnId === 0) {
            return { turnId: 0, files: [] };
          }

          const baseline = sg.findCommitByMessage(commitMsg(sessionId, latestTurnId, 'baseline'));
          const final = sg.findCommitByMessage(commitMsg(sessionId, latestTurnId, 'final'));
          if (!baseline || !final) return { turnId: latestTurnId, files: [] };

          const allChanges = sg.diffFiles(baseline, final);
          const rawAllFiles = allChanges.map((c) => normalizePath(resolve(projectPath, c.file)));
          const allFiles = [...new Set(rawAllFiles)];

          const files = allFiles.map((f) => {
            const relPath = toGitPath(projectPath, f);
            const diffResult = sg.git('diff', baseline, final, '--', relPath);
            const rawPath = normalizePath(resolve(projectPath, relPath));
            let insertions = 0;
            let deletions = 0;
            for (const line of diffResult.stdout.split('\n')) {
              if (line.startsWith('+') && !line.startsWith('+++')) insertions++;
              else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
            }
            return {
              path: f,
              status:
                allChanges.find(
                  (c) =>
                    normalizePath(resolve(projectPath, c.file)).toLowerCase() ===
                    rawPath.toLowerCase()
                )?.status ?? 'M',
              diff: diffResult.stdout,
              insertions,
              deletions,
            };
          });

          return { turnId: latestTurnId, files };
        }),

      revertCheckpointFiles: (
        projectPath: string,
        sessionId: string,
        turnId: number | undefined,
        files: string[]
      ) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          const targetTurnId = turnId ?? latestCompletedTurn(sg, sessionId);
          if (targetTurnId === 0) return emptyRollbackResult(0);
          const plan = getTurnRestorePlan(sg, sessionId, targetTurnId);
          if (!plan) {
            return emptyRollbackResult(targetTurnId);
          }
          return executeRollback(plan, files, sg, lockFor(projectPath));
        }),

      previewRollbackDiff: (projectPath: string, sessionId: string, throughTurnId: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          const plan = getRollbackToTurnPlan(sg, sessionId, throughTurnId);
          if (!plan) {
            return { throughTurnId, affectedTurns: [], diff: '' };
          }

          const result = sg.git('diff', plan.baseline);
          return {
            throughTurnId,
            affectedTurns: plan.affectedTurns,
            diff: result.stdout,
          };
        }),

      rollbackCodeToTurn: (projectPath: string, sessionId: string, throughTurnId: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          const plan = getRollbackToTurnPlan(sg, sessionId, throughTurnId);
          if (!plan) {
            return emptyRollbackResult(throughTurnId);
          }

          const diffResult = sg.git('diff', '--name-only', plan.baseline);
          const selectedFiles = diffResult.stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((f) => resolve(projectPath, f));

          if (selectedFiles.length === 0) {
            return {
              reverted: true,
              throughTurnId,
              affectedTurns: plan.affectedTurns,
              selectedFiles: [],
            };
          }

          return executeRollback(plan, selectedFiles, sg, lockFor(projectPath));
        }),
    };
}));
