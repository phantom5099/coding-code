import { Effect } from 'effect';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { ShadowGit } from './shadow-git.js';
import { ProjectLock } from './project-lock.js';
import { normalizePath } from '../core/path.js';
import { Ledger } from './ledger.js';
import { registerCheckpointHooks } from './hook-recorder.js';
import { HookService } from '../hooks/registry.js';
import { shortSid, commitMsg } from './commit-naming.js';
import { readRestoreEntry, writeRestoreEntry } from './restore-store.js';
import { classifyDiff, parseDiffStats } from './classification.js';
import {
  getCompletedTurnsFor,
  getTurnRestorePlan,
  getRollbackToTurnPlan,
  type RestorePlan,
} from './restore-planning.js';
import { emptyRollbackResult, executeRollback } from './rollback-engine.js';

// ---- Exported types ----

export interface CheckpointDiff {
  turnId: number;
  files: Array<{
    path: string;
    source: 'agent' | 'unknown';
    status: string;
    diff: string;
    insertions: number;
    deletions: number;
  }>;
}

export interface CodeRollbackResult {
  reverted: boolean;
  throughTurnId: number;
  baseTurnId: number | null;
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
  baseTurnId: number | null;
  affectedTurns: number[];
  diff: string;
}

export interface CodeRestoreEntry {
  id: string;
  sessionId: string;
  action:
    | 'checkpoint-file'
    | 'checkpoint-files'
    | 'checkpoint-agent'
    | 'checkpoint-all'
    | 'rollback-to-turn';
  throughTurnId: number;
  baseTurnId: number;
  affectedTurns: number[];
  selectedFiles: string[];
  safetyCommit: string;
  timestamp: string;
}

// ---- Path utilities ----

export function toGitPath(projectPath: string, file: string): string {
  const normalized = normalizePath(file);
  const base = normalizePath(projectPath);
  if (normalized.toLowerCase().startsWith(base.toLowerCase())) {
    let rel = normalized.slice(base.length);
    if (rel.startsWith('/') || rel.startsWith('\\')) rel = rel.slice(1);
    return rel;
  }
  return normalized;
}

export function hashWorkspaceFile(projectPath: string, file: string): string | null {
  try {
    const content = readFileSync(resolve(projectPath, toGitPath(projectPath, file)));
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

// ---- Service ----

export class CheckpointService extends Effect.Service<CheckpointService>()('Checkpoint', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    registerCheckpointHooks(hooks);

    const shadowGitByProject = new Map<string, ShadowGit>();
    const lockByProject = new Map<string, ProjectLock>();
    const ledgerByProject = new Map<string, { ledger: Ledger; gitDir: string }>();

    function ensure(projectPath: string): ShadowGit {
      const normalized = normalizePath(projectPath);
      let sg = shadowGitByProject.get(normalized);
      if (!sg || sg.projectPath !== normalized) {
        sg = new ShadowGit(normalized);
        sg.init();
        shadowGitByProject.set(normalized, sg);
      }
      return sg;
    }

    function lockFor(projectPath: string): ProjectLock {
      const normalized = normalizePath(projectPath);
      let lock = lockByProject.get(normalized);
      if (!lock) {
        lock = new ProjectLock(normalized);
        lockByProject.set(normalized, lock);
      }
      return lock;
    }

    function ledger(sg: ShadowGit): Ledger {
      const key = sg.gitDir;
      let entry = ledgerByProject.get(key);
      if (!entry || entry.gitDir !== key) {
        const l = new Ledger(dirname(sg.gitDir));
        entry = { ledger: l, gitDir: key };
        ledgerByProject.set(key, entry);
      }
      return entry.ledger;
    }

    return {
      // ---- Snapshot ----

      snapshotBaseline: (
        projectPath: string,
        sessionId: string,
        turnId: number,
        title?: string
      ): void => {
        const sg = ensure(projectPath);
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
      },

      snapshotFinal: (projectPath: string, sessionId: string, turnId: number): void => {
        const sg = ensure(projectPath);
        if (sg.isTooLargeForSnapshot()) return;
        const lock = lockFor(projectPath);
        lock.lock();
        try {
          sg.commit(commitMsg(sessionId, turnId, 'final'));
        } finally {
          lock.unlock();
        }
      },

      // ---- Classification ----

      classifyChanges: (
        projectPath: string,
        sessionId: string,
        turnId: number
      ): { agentModified: string[]; unknownSource: string[] } | null => {
        const sg = ensure(projectPath);
        const l = ledger(sg);
        return classifyDiff(projectPath, sessionId, turnId, sg, l);
      },

      // ---- Query ----

      getCompletedTurns: (projectPath: string, sessionId: string): number[] => {
        const sg = ensure(projectPath);
        return getCompletedTurnsFor(sg, sessionId);
      },

      getCheckpoints: (
        projectPath: string,
        sessionId: string
      ): Array<{
        turnId: number;
        title: string;
        agentModified: string[];
        unknownSource: string[];
      }> => {
        const sg = ensure(projectPath);
        const l = ledger(sg);
        const prefix = `turn-${shortSid(sessionId)}-`;
        const completedTurns = getCompletedTurnsFor(sg, sessionId);
        const result: Array<{
          turnId: number;
          title: string;
          agentModified: string[];
          unknownSource: string[];
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
          const rawAllFiles = allChanges.map((c) => normalizePath(resolve(projectPath, c.file)));
          const allFiles = [...new Set(rawAllFiles)];
          const agentFiles = new Set(
            l.getAgentFiles(i, sessionId).map((p) => normalizePath(p).toLowerCase())
          );

          result.push({
            turnId: i,
            title,
            agentModified: allFiles.filter((f) => agentFiles.has(f.toLowerCase())),
            unknownSource: allFiles.filter((f) => !agentFiles.has(f.toLowerCase())),
          });
        }
        return result;
      },

      getCheckpointDiff: (
        projectPath: string,
        sessionId: string,
        turnId?: number
      ): CheckpointDiff => {
        const sg = ensure(projectPath);
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
        const agentFiles = new Set(
          ledger(sg)
            .getAgentFiles(latestTurnId, sessionId)
            .map((p) => normalizePath(p).toLowerCase())
        );

        const files = allFiles.map((f) => {
          const relPath = toGitPath(projectPath, f);
          const diffResult = sg.git('diff', baseline, final, '--', relPath);
          const rawPath = normalizePath(resolve(projectPath, relPath));
          const stats = parseDiffStats(diffResult.stdout);
          return {
            path: f,
            source: (agentFiles.has(f.toLowerCase()) ? 'agent' : 'unknown') as 'agent' | 'unknown',
            status:
              allChanges.find(
                (c) =>
                  normalizePath(resolve(projectPath, c.file)).toLowerCase() ===
                  rawPath.toLowerCase()
              )?.status ?? 'M',
            diff: diffResult.stdout,
            insertions: stats.insertions,
            deletions: stats.deletions,
          };
        });

        return { turnId: latestTurnId, files };
      },

      // ---- Revert ----

      revertCheckpointFile: (
        projectPath: string,
        sessionId: string,
        turnId: number,
        file: string
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan) {
          return emptyRollbackResult(turnId, turnId);
        }
        return executeRollback(projectPath, sessionId, plan, [file], 'checkpoint-file', sg, lockFor(projectPath));
      },

      revertCheckpointFiles: (
        projectPath: string,
        sessionId: string,
        turnId: number,
        files: string[]
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan) {
          return emptyRollbackResult(turnId, turnId);
        }
        return executeRollback(projectPath, sessionId, plan, files, 'checkpoint-files', sg, lockFor(projectPath));
      },

      revertCheckpointAgentFiles: (
        projectPath: string,
        sessionId: string,
        turnId: number
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const l = ledger(sg);
        const changes = classifyDiff(projectPath, sessionId, turnId, sg, l);
        if (!changes) {
          return emptyRollbackResult(turnId);
        }
        if (changes.agentModified.length === 0) {
          return emptyRollbackResult(turnId);
        }
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan) {
          return emptyRollbackResult(turnId);
        }
        return executeRollback(projectPath, sessionId, plan, changes.agentModified, 'checkpoint-agent', sg, lockFor(projectPath));
      },

      revertCheckpointAllFiles: (
        projectPath: string,
        sessionId: string,
        turnId: number
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const l = ledger(sg);
        const changes = classifyDiff(projectPath, sessionId, turnId, sg, l);
        if (!changes) {
          return emptyRollbackResult(turnId);
        }
        const all = [...changes.agentModified, ...changes.unknownSource];
        if (all.length === 0) {
          return emptyRollbackResult(turnId);
        }
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan) {
          return emptyRollbackResult(turnId);
        }
        return executeRollback(projectPath, sessionId, plan, all, 'checkpoint-all', sg, lockFor(projectPath));
      },

      // ---- Rollback ----

      previewRollbackDiff: (
        projectPath: string,
        sessionId: string,
        throughTurnId: number
      ): RollbackPreviewDiff => {
        const sg = ensure(projectPath);
        const plan = getRollbackToTurnPlan(sg, sessionId, throughTurnId);
        if (!plan) {
          return { throughTurnId, baseTurnId: null, affectedTurns: [], diff: '' };
        }

        const result = sg.git('diff', plan.baseline);
        return {
          throughTurnId,
          baseTurnId: plan.baseTurnId,
          affectedTurns: plan.affectedTurns,
          diff: result.stdout,
        };
      },

      rollbackCodeToTurn: (
        projectPath: string,
        sessionId: string,
        throughTurnId: number
      ): CodeRollbackResult => {
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
            baseTurnId: plan.baseTurnId,
            affectedTurns: plan.affectedTurns,
            selectedFiles: [],
            restoreEntry: null,
          };
        }

        return executeRollback(projectPath, sessionId, plan, selectedFiles, 'rollback-to-turn', sg, lockFor(projectPath));
      },

      undoLastCodeRollback: (
        projectPath: string,
        sessionId: string,
        opts?: { force?: boolean; files?: string[] }
      ): CodeRollbackUndoResult => {
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
          commitMsg(sessionId, entry.baseTurnId, 'baseline')
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
      },

      getLatestRestoreEntry: (projectPath: string, sessionId: string): CodeRestoreEntry | null => {
        const sg = ensure(projectPath);
        return readRestoreEntry(sg.gitDir, sessionId);
      },
    };
  }),
}) {}
