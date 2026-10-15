import { Layer, Effect } from 'effect';
import { resolve } from 'path';
import { ShadowGit } from './shadow-git.js';
import { normalizePath } from '../util/path.js';
import { commitMsg, rollbackSnapshotMsg, toGitPath, ProjectCache } from './utils.js';
import {
  getTurnsWithBaseline,
  getTurnRestorePlan,
  getRollbackToTurnPlan,
  findLatestRollbackSnapshot,
  findRollbackSnapshot,
} from './turn-query.js';
import { emptyRollbackResult, executeRollback } from './rollback-engine.js';
import { CheckpointService } from './port.js';

// ---- Effect Service ----
const shadowGitByProject = new ProjectCache<ShadowGit>(10);
const baselineTurnBySession = new Map<string, number>();

export const CheckpointLayer = Layer.effect(
  CheckpointService,
  Effect.gen(function* () {
    function ensure(projectPath: string): ShadowGit {
      const normalized = normalizePath(projectPath);
      return shadowGitByProject.get(normalized, () => {
        const sg = new ShadowGit(normalized);
        sg.init();
        return sg;
      });
    }

    function latestBaselineTurn(sg: ShadowGit, sessionId: string): number {
      const turns = getTurnsWithBaseline(sg, sessionId);
      return turns.length > 0 ? turns[turns.length - 1]! : 0;
    }

    function ensureRollbackSnapshot(
      sg: ShadowGit,
      sessionId: string,
      rollbackTurnId: number,
      baselineTurnId: number
    ): void {
      if (findRollbackSnapshot(sg, sessionId, rollbackTurnId, baselineTurnId)) return;
      sg.stageAll();
      if (sg.isTooLargeForSnapshot()) return;
      sg.commit(rollbackSnapshotMsg(sessionId, rollbackTurnId, baselineTurnId));
    }

    return {
      snapshotBeforeWrite: (projectPath: string, sessionId: string, turnId: number) =>
        Effect.sync(() => {
          if (baselineTurnBySession.get(sessionId) === turnId) return;
          baselineTurnBySession.set(sessionId, turnId);
          const sg = ensure(projectPath);
          sg.stageAll();
          if (sg.isTooLargeForSnapshot()) return;
          sg.commit(commitMsg(sessionId, turnId));
        }),

      getCheckpointDiff: (projectPath: string, sessionId: string, turnId?: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          sg.stageAll();
          const latestTurnId = turnId ?? latestBaselineTurn(sg, sessionId);
          if (latestTurnId === 0) {
            return { turnId: 0, files: [] };
          }

          const baseline = sg.findCommitByMessage(commitMsg(sessionId, latestTurnId));
          if (!baseline) return { turnId: latestTurnId, files: [] };

          const files = sg.diffNameStatusAgainstWorkspace(baseline).map((c) => {
            const f = normalizePath(resolve(projectPath, c.file));
            const relPath = toGitPath(projectPath, f);
            const diffText = sg.git('diff', baseline, '--', relPath).stdout;
            let insertions = 0;
            let deletions = 0;
            for (const line of diffText.split('\n')) {
              if (line.startsWith('+') && !line.startsWith('+++')) insertions++;
              else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
            }
            return {
              path: f,
              status: c.status,
              diff: diffText,
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
          sg.stageAll();
          const targetTurnId = turnId ?? latestBaselineTurn(sg, sessionId);
          if (targetTurnId === 0) return emptyRollbackResult(0);
          const plan = getTurnRestorePlan(sg, sessionId, targetTurnId);
          if (!plan) {
            return emptyRollbackResult(targetTurnId);
          }
          ensureRollbackSnapshot(sg, sessionId, latestBaselineTurn(sg, sessionId), targetTurnId);
          return executeRollback(plan, files, sg);
        }),

      previewRollbackDiff: (projectPath: string, sessionId: string, throughTurnId: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          sg.stageAll();
          const plan = getRollbackToTurnPlan(sg, sessionId, throughTurnId);
          if (!plan) {
            return { throughTurnId, affectedTurns: [], diff: '' };
          }

          const diff = sg.git('diff', plan.baseline).stdout;
          return {
            throughTurnId,
            affectedTurns: plan.affectedTurns,
            diff,
          };
        }),

      rollbackCodeToTurn: (projectPath: string, sessionId: string, throughTurnId: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          sg.stageAll();
          const plan = getRollbackToTurnPlan(sg, sessionId, throughTurnId);
          if (!plan) {
            return emptyRollbackResult(throughTurnId);
          }

          ensureRollbackSnapshot(sg, sessionId, latestBaselineTurn(sg, sessionId), throughTurnId);

          const selectedFiles = sg
            .diffNameStatusAgainstWorkspace(plan.baseline)
            .map((c) => resolve(projectPath, c.file));

          if (selectedFiles.length === 0) {
            return {
              reverted: true,
              throughTurnId,
              affectedTurns: plan.affectedTurns,
              selectedFiles: [],
            };
          }

          return executeRollback(plan, selectedFiles, sg);
        }),

      undoRollback: (
        projectPath: string,
        sessionId: string,
        turnId: number | undefined,
        files: string[]
      ) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          const targetTurnId = turnId ?? latestBaselineTurn(sg, sessionId);
          if (targetTurnId === 0) return emptyRollbackResult(0);
          if (files.length === 0) return emptyRollbackResult(targetTurnId);

          // 恢复到“最近一次回退该 baseline 之前”的快照
          const snapshot = findLatestRollbackSnapshot(sg, sessionId, targetTurnId);
          const plan = getTurnRestorePlan(sg, sessionId, targetTurnId);
          if (!snapshot || !plan) {
            return emptyRollbackResult(targetTurnId);
          }

          sg.checkoutFiles(snapshot.commit, files);
          sg.stageAll();
          return {
            reverted: true,
            throughTurnId: targetTurnId,
            affectedTurns: plan.affectedTurns,
            selectedFiles: files,
          };
        }),
    };
  })
);
