import { Effect } from 'effect';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { ShadowGit, normalizePath } from './shadow-git.js';
import { Ledger } from './ledger.js';
import { bootstrapCheckpoint } from './bootstrap.js';
import { HookService } from '../hooks/registry.js';
import { createHash } from 'crypto';

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

// ---- Module-level helpers ----

function shortSid(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
}

function commitMsg(sessionId: string, turnId: number, suffix: string): string {
  return `turn-${shortSid(sessionId)}-${turnId}-${suffix}`;
}

function restorePath(gitDir: string, sessionId: string): string {
  return join(dirname(gitDir), `last-restore-${shortSid(sessionId)}.json`);
}

function readRestoreEntry(gitDir: string, sessionId: string): CodeRestoreEntry | null {
  const path = restorePath(gitDir, sessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CodeRestoreEntry;
  } catch {
    return null;
  }
}

function writeRestoreEntry(
  gitDir: string,
  sessionId: string,
  entry: CodeRestoreEntry | null
): void {
  const path = restorePath(gitDir, sessionId);
  if (!entry) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  } else {
    writeFileSync(path, JSON.stringify(entry, null, 2), 'utf8');
  }
}

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

function classifySafe(
  projectPath: string,
  sessionId: string,
  turnId: number,
  sg: ShadowGit,
  ledgerInstance: Ledger
): { agentModified: string[]; unknownSource: string[] } | null {
  const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'baseline'));
  const final = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'final'));
  if (!baseline || !final) return null;

  const allChanges = sg.diffFiles(baseline, final);
  const rawAllFiles = allChanges.map((c) => normalizePath(resolve(projectPath, c.file)));
  const allFiles = [...new Set(rawAllFiles)];
  const agentFiles = new Set(
    ledgerInstance.getAgentFiles(turnId, sessionId).map((p) => normalizePath(p).toLowerCase())
  );

  return {
    agentModified: allFiles.filter((f) => agentFiles.has(f.toLowerCase())),
    unknownSource: allFiles.filter((f) => !agentFiles.has(f.toLowerCase())),
  };
}

/** Parse insertions/deletions from a unified diff string. */
function parseDiffStats(diffText: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) insertions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { insertions, deletions };
}

function getCompletedTurnsFor(sg: ShadowGit, sessionId: string): number[] {
  const ids: number[] = [];
  const prefix = `turn-${shortSid(sessionId)}-`;
  for (let i = 1; i <= 10000; i++) {
    const b = sg.findCommitByMessage(`${prefix}${i}-baseline`);
    const f = sg.findCommitByMessage(`${prefix}${i}-final`);
    if (b && f) ids.push(i);
    if (!b && !f) break;
  }
  return ids;
}

interface RestorePlan {
  throughTurnId: number;
  baseTurnId: number;
  affectedTurns: number[];
  baseline: string;
}

function getTurnRestorePlan(sg: ShadowGit, sessionId: string, turnId: number): RestorePlan | null {
  const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'baseline'));
  const final = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'final'));
  if (!baseline || !final) return null;
  return {
    throughTurnId: turnId,
    baseTurnId: turnId,
    affectedTurns: [],
    baseline,
  };
}

function getRollbackToTurnPlan(
  sg: ShadowGit,
  sessionId: string,
  throughTurnId: number
): RestorePlan | null {
  const completedTurns = getCompletedTurnsFor(sg, sessionId);
  const affectedTurns = completedTurns.filter((id) => id >= throughTurnId);
  if (affectedTurns.length === 0) return null;

  const baseline = sg.findCommitByMessage(commitMsg(sessionId, throughTurnId, 'baseline'));
  if (!baseline) return null;

  return {
    throughTurnId,
    baseTurnId: throughTurnId,
    affectedTurns,
    baseline,
  };
}

function revertFilesImpl(
  projectPath: string,
  sessionId: string,
  plan: RestorePlan,
  selectedFiles: string[],
  action: CodeRestoreEntry['action'],
  sg: ShadowGit
): CodeRollbackResult {
  if (selectedFiles.length === 0) {
    return {
      reverted: false,
      throughTurnId: plan.throughTurnId,
      baseTurnId: plan.baseTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles: [],
      restoreEntry: null,
    };
  }

  sg.lock();
  try {
    let safetyCommit: string;
    const existingEntry = readRestoreEntry(sg.gitDir, sessionId);

    if (
      existingEntry &&
      existingEntry.throughTurnId === plan.throughTurnId &&
      existingEntry.safetyCommit
    ) {
      safetyCommit = existingEntry.safetyCommit;
    } else {
      safetyCommit = sg.commit(commitMsg(sessionId, plan.throughTurnId, 'revert-safety'));
    }

    sg.checkoutFiles(plan.baseline, selectedFiles);

    const combinedFiles =
      existingEntry && existingEntry.throughTurnId === plan.throughTurnId
        ? [
            ...new Map(
              [...existingEntry.selectedFiles, ...selectedFiles].map((f) => [
                normalizePath(f).toLowerCase(),
                f,
              ])
            ).values(),
          ]
        : selectedFiles;

    const entry: CodeRestoreEntry = {
      id: createHash('sha256')
        .update(`${sessionId}-${plan.throughTurnId}-${Date.now()}`)
        .digest('hex')
        .slice(0, 12),
      sessionId,
      action,
      throughTurnId: plan.throughTurnId,
      baseTurnId: plan.baseTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles: combinedFiles,
      safetyCommit,
      timestamp: new Date().toISOString(),
    };
    writeRestoreEntry(sg.gitDir, sessionId, entry);

    return {
      reverted: true,
      throughTurnId: plan.throughTurnId,
      baseTurnId: plan.baseTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles: combinedFiles,
      restoreEntry: entry,
    };
  } finally {
    sg.unlock();
  }
}

// ---- Service ----

export class CheckpointService extends Effect.Service<CheckpointService>()('Checkpoint', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    bootstrapCheckpoint(hooks);

    const shadowGitByProject = new Map<string, ShadowGit>();
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
      // ---- Snapshot methods (unchanged) ----

      snapshotBaseline: (
        projectPath: string,
        sessionId: string,
        turnId: number,
        title?: string
      ): void => {
        const sg = ensure(projectPath);
        const msg = title
          ? `${commitMsg(sessionId, turnId, 'baseline')} ${title}`
          : commitMsg(sessionId, turnId, 'baseline');
        sg.lock();
        try {
          sg.commit(msg);
        } finally {
          sg.unlock();
        }
      },

      snapshotFinal: (projectPath: string, sessionId: string, turnId: number): void => {
        const sg = ensure(projectPath);
        sg.lock();
        try {
          sg.commit(commitMsg(sessionId, turnId, 'final'));
        } finally {
          sg.unlock();
        }
      },

      classifyChanges: (
        projectPath: string,
        sessionId: string,
        turnId: number
      ): { agentModified: string[]; unknownSource: string[] } | null => {
        const sg = ensure(projectPath);
        const l = ledger(sg);
        return classifySafe(projectPath, sessionId, turnId, sg, l);
      },

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
        const prefix = `turn-${shortSid(sessionId)}-`;
        const result: Array<{
          turnId: number;
          title: string;
          agentModified: string[];
          unknownSource: string[];
        }> = [];
        for (let i = 1; i <= 10000; i++) {
          const bCommit = sg.findCommitByMessage(`${prefix}${i}-baseline`);
          const fCommit = sg.findCommitByMessage(`${prefix}${i}-final`);
          if (!bCommit || !fCommit) {
            if (result.length === 0 && i === 1) continue;
            else break;
          }
          const msgResult = sg.git(
            'log',
            '--all',
            '--grep',
            `${prefix}${i}-baseline`,
            '--format=%s',
            '-1'
          );
          const fullMsg = msgResult.stdout.trim();
          const title = fullMsg.includes(' ') ? fullMsg.split(' ').slice(1).join(' ') : '';

          const allChanges = sg.diffFiles(bCommit, fCommit);
          const rawAllFiles = allChanges.map((c) => normalizePath(resolve(projectPath, c.file)));
          const allFiles = [...new Set(rawAllFiles)];
          const agentFiles = new Set(
            ledger(sg)
              .getAgentFiles(i, sessionId)
              .map((p) => normalizePath(p).toLowerCase())
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

      // ---- B1: getCheckpointDiff ----

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

      // ---- B2: revertCheckpointFile / revertCheckpointFiles ----

      revertCheckpointFile: (
        projectPath: string,
        sessionId: string,
        turnId: number,
        file: string
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan)
          return {
            reverted: false,
            throughTurnId: turnId,
            baseTurnId: turnId,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
        return revertFilesImpl(projectPath, sessionId, plan, [file], 'checkpoint-file', sg);
      },

      revertCheckpointFiles: (
        projectPath: string,
        sessionId: string,
        turnId: number,
        files: string[]
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan)
          return {
            reverted: false,
            throughTurnId: turnId,
            baseTurnId: turnId,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
        return revertFilesImpl(projectPath, sessionId, plan, files, 'checkpoint-files', sg);
      },

      // ---- B3: revertCheckpointAgentFiles / revertCheckpointAllFiles ----

      revertCheckpointAgentFiles: (
        projectPath: string,
        sessionId: string,
        turnId: number
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const l = ledger(sg);
        const changes = classifySafe(projectPath, sessionId, turnId, sg, l);
        if (!changes)
          return {
            reverted: false,
            throughTurnId: turnId,
            baseTurnId: null,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
        if (changes.agentModified.length === 0)
          return {
            reverted: false,
            throughTurnId: turnId,
            baseTurnId: null,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan)
          return {
            reverted: false,
            throughTurnId: turnId,
            baseTurnId: null,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
        return revertFilesImpl(
          projectPath,
          sessionId,
          plan,
          changes.agentModified,
          'checkpoint-agent',
          sg
        );
      },

      revertCheckpointAllFiles: (
        projectPath: string,
        sessionId: string,
        turnId: number
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const l = ledger(sg);
        const changes = classifySafe(projectPath, sessionId, turnId, sg, l);
        if (!changes)
          return {
            reverted: false,
            throughTurnId: turnId,
            baseTurnId: null,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
        const all = [...changes.agentModified, ...changes.unknownSource];
        if (all.length === 0)
          return {
            reverted: false,
            throughTurnId: turnId,
            baseTurnId: null,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
        const plan = getTurnRestorePlan(sg, sessionId, turnId);
        if (!plan)
          return {
            reverted: false,
            throughTurnId: turnId,
            baseTurnId: null,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
        return revertFilesImpl(projectPath, sessionId, plan, all, 'checkpoint-all', sg);
      },

      // ---- B4: previewRollbackDiff ----

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

      // ---- B5: rollbackCodeToTurn ----

      rollbackCodeToTurn: (
        projectPath: string,
        sessionId: string,
        throughTurnId: number
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const plan = getRollbackToTurnPlan(sg, sessionId, throughTurnId);
        if (!plan) {
          return {
            reverted: false,
            throughTurnId,
            baseTurnId: null,
            affectedTurns: [],
            selectedFiles: [],
            restoreEntry: null,
          };
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

        return revertFilesImpl(projectPath, sessionId, plan, selectedFiles, 'rollback-to-turn', sg);
      },

      // ---- B6: undoLastCodeRollback ----

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

        // Conflict detection: compare current workspace files against baseline commit.
        // After revert, files should equal baseline. Any divergence = conflict.
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

        sg.lock();
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
          sg.unlock();
        }
      },

      // ---- getLatestRestoreEntry ----

      getLatestRestoreEntry: (projectPath: string, sessionId: string): CodeRestoreEntry | null => {
        const sg = ensure(projectPath);
        return readRestoreEntry(sg.gitDir, sessionId);
      },
    };
  }),
}) {}
