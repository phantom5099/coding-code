import { Effect } from 'effect';
import { createHash } from 'crypto';
import { resolve } from 'path';
import { ShadowGit } from './shadow-git.js';
import { ProjectLock } from './project-lock.js';
import { normalizePath } from '../core/path.js';
import { shortSid, commitMsg, toGitPath, hashWorkspaceFile, ProjectCache } from './utils.js';
import { readRestoreEntry, writeRestoreEntry } from './undo-store.js';
import {
  getCompletedTurnsFor,
  getTurnRestorePlan,
  getRollbackToTurnPlan,
} from './turn-query.js';
import { emptyRollbackResult, executeRollback } from './rollback-engine.js';

// ---- Exported types ----

export interface CheckpointDiff {
  turnId: number;
  files: Array<{
    path: string;
    status: string;
    diff: string;
    insertions: number;
    deletions: number;
  }>;
}

export interface CodeRollbackResult {
  reverted: boolean;
  throughTurnId: number;
  affectedTurns: number[];
  selectedFiles: string[];
  restoreEntry: CodeRestoreEntry | null;
}

export interface CodeRollbackUndoResult {
  restored: boolean;
  conflict: boolean;
  conflictFiles: string[];
  restoredFiles: string[];
  remainingRolledBack: string[];
}

export interface RollbackPreviewDiff {
  throughTurnId: number;
  affectedTurns: number[];
  diff: string;
}

export interface CodeRestoreEntry {
  id: string;
  sessionId: string;
  action: 'checkpoint-files' | 'rollback-to-turn';
  throughTurnId: number;
  affectedTurns: number[];
  selectedFiles: string[];
  safetyCommit: string;
  timestamp: string;
}

// ---- Effect Service ----

export class CheckpointService extends Effect.Service<CheckpointService>()('Checkpoint', {
  effect: Effect.gen(function* () {
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

    return {
      snapshotBaseline: (
        projectPath: string,
        sessionId: string,
        turnId: number,
        title?: string
      ) => Effect.sync(() => {
        const sg = ensure(projectPath);
        repairIncompleteTurn(sg, sessionId);
        if (sg.isTooLargeForSnapshot()) return;
        const lock = lockFor(projectPath);
        const msg = title
          ? `${commitMsg(sessionId, turnId, 'baseline')} ${title}`
          : commitMsg(sessionId, turnId, 'baseline');
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

      getCompletedTurns: (projectPath: string, sessionId: string) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          repairIncompleteTurn(sg, sessionId);
          return getCompletedTurnsFor(sg, sessionId);
        }),

      getCheckpoints: (projectPath: string, sessionId: string) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          repairIncompleteTurn(sg, sessionId);
          const prefix = `turn-${shortSid(sessionId)}-`;
          const completedTurns = getCompletedTurnsFor(sg, sessionId);
          const result: Array<{
            turnId: number;
            title: string;
            files: string[];
          }> = [];

          for (const i of completedTurns) {
            const bCommit = sg.findCommitByMessage(`${prefix}${i}-baseline`);
            if (!bCommit) continue;
            const fCommit = sg.findCommitByMessage(`${prefix}${i}-final`);
            if (!fCommit) continue;

            const msgResult = sg.git('log', '--all', '--grep', `${prefix}${i}-baseline`, '--format=%s', '-1');
            const fullMsg = msgResult.stdout.trim();
            const title = fullMsg.includes(' ') ? fullMsg.split(' ').slice(1).join(' ') : '';

            const allChanges = sg.diffFiles(bCommit, fCommit);
            const files = [...new Set(allChanges.map((c) => normalizePath(resolve(projectPath, c.file))))];

            result.push({ turnId: i, title, files });
          }
          return result;
        }),

      getCheckpointDiff: (projectPath: string, sessionId: string, turnId?: number) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          repairIncompleteTurn(sg, sessionId);
          const completedTurns = getCompletedTurnsFor(sg, sessionId);
          const latestTurnId =
            turnId ?? (completedTurns.length > 0 ? completedTurns[completedTurns.length - 1]! : 0);
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
        turnId: number,
        files: string[]
      ) => Effect.sync(() => {
        const sg = ensure(projectPath);
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan) {
          return emptyRollbackResult(turnId);
        }
        return executeRollback(sessionId, plan, files, 'checkpoint-files', sg, lockFor(projectPath));
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
              restoreEntry: null,
            };
          }

          return executeRollback(sessionId, plan, selectedFiles, 'rollback-to-turn', sg, lockFor(projectPath));
        }),

      undoLastCodeRollback: (
        projectPath: string,
        sessionId: string,
        opts?: { force?: boolean; files?: string[] }
      ) => Effect.sync(() => {
        const sg = ensure(projectPath);
        const entry = readRestoreEntry(sg.gitDir, sessionId);
        if (!entry) {
          return {
            restored: false,
            conflict: false,
            conflictFiles: [],
            restoredFiles: [],
            remainingRolledBack: [],
          };
        }

        const normalizedOptsFiles =
          opts?.files && opts.files.length > 0
            ? new Set(opts.files.map((f) => normalizePath(f).toLowerCase()))
            : null;
        const filesToRestore = normalizedOptsFiles
          ? entry.selectedFiles.filter((f) =>
              normalizedOptsFiles.has(normalizePath(f).toLowerCase())
            )
          : [...entry.selectedFiles];

        if (filesToRestore.length === 0) {
          return {
            restored: false,
            conflict: false,
            conflictFiles: [],
            restoredFiles: [],
            remainingRolledBack: entry.selectedFiles,
          };
        }

        const baselineCommit = sg.findCommitByMessage(
          commitMsg(sessionId, entry.throughTurnId, 'baseline')
        );
        const conflictFiles: string[] = [];

        if (baselineCommit) {
          for (const f of filesToRestore) {
            const gitPath = toGitPath(projectPath, f);
            const currentHash = hashWorkspaceFile(projectPath, f);
            const baselineContent = sg.showFile(baselineCommit, gitPath);
            const baselineHash =
              baselineContent !== null
                ? createHash('sha256').update(baselineContent).digest('hex')
                : null;

            if (currentHash !== baselineHash) {
              conflictFiles.push(f);
            }
          }
        }

        if (conflictFiles.length > 0 && !opts?.force) {
          return {
            restored: false,
            conflict: true,
            conflictFiles,
            restoredFiles: [],
            remainingRolledBack: entry.selectedFiles,
          };
        }

        const lock = lockFor(projectPath);
        lock.lock();
        try {
          sg.checkoutFiles(entry.safetyCommit, filesToRestore);

          const remainingFiles = entry.selectedFiles.filter(
            (f) =>
              !filesToRestore.some(
                (rf) => normalizePath(rf).toLowerCase() === normalizePath(f).toLowerCase()
              )
          );
          if (remainingFiles.length === 0) {
            writeRestoreEntry(sg.gitDir, sessionId, null);
          } else {
            writeRestoreEntry(sg.gitDir, sessionId, { ...entry, selectedFiles: remainingFiles });
          }

          return {
            restored: true,
            conflict: conflictFiles.length > 0,
            conflictFiles,
            restoredFiles: filesToRestore,
            remainingRolledBack: remainingFiles,
          };
        } finally {
          lock.unlock();
        }
      }),

      getLatestRestoreEntry: (projectPath: string, sessionId: string) =>
        Effect.sync(() => {
          const sg = ensure(projectPath);
          return readRestoreEntry(sg.gitDir, sessionId);
        }),
    };
  }),
}) {}
