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
  action: 'checkpoint-file' | 'checkpoint-files' | 'checkpoint-agent' | 'checkpoint-all' | 'rollback-to-turn';
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
  try { return JSON.parse(readFileSync(path, 'utf8')) as CodeRestoreEntry; }
  catch { return null; }
}

function writeRestoreEntry(gitDir: string, sessionId: string, entry: CodeRestoreEntry | null): void {
  const path = restorePath(gitDir, sessionId);
  if (!entry) { try { unlinkSync(path); } catch { /* ignore */ } }
  else { writeFileSync(path, JSON.stringify(entry, null, 2), 'utf8'); }
}

export function toGitPath(projectPath: string, file: string): string {
  const normalized = normalizePath(file);
  const base = normalizePath(projectPath);
  if (normalized.startsWith(base)) {
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
  } catch { return null; }
}

function classifySafe(
  projectPath: string, sessionId: string, turnId: number, sg: ShadowGit,
): { agentModified: string[]; unknownSource: string[] } | null {
  const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'baseline'));
  const final = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'final'));
  if (!baseline || !final) return null;

  const allChanges = sg.diffFiles(baseline, final);
  const allFiles = [...new Set(allChanges.map((c) => normalizePath(resolve(projectPath, c.file)).toLowerCase()))];
  const l = new Ledger(dirname(sg.gitDir));
  const agentFiles = new Set(l.getAgentFiles(turnId, sessionId).map((p) => normalizePath(p).toLowerCase()));

  return {
    agentModified: allFiles.filter((f) => agentFiles.has(f)),
    unknownSource: allFiles.filter((f) => !agentFiles.has(f)),
  };
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

function revertFilesImpl(
  projectPath: string, sessionId: string, turnId: number,
  selectedFiles: string[], action: CodeRestoreEntry['action'],
  sg: ShadowGit,
): CodeRollbackResult {
  if (selectedFiles.length === 0) {
    return { reverted: false, throughTurnId: turnId, baseTurnId: turnId, affectedTurns: [], selectedFiles: [], restoreEntry: null };
  }

  const baseline = sg.findCommitByMessage(commitMsg(sessionId, turnId, 'baseline'));
  if (!baseline) return { reverted: false, throughTurnId: turnId, baseTurnId: turnId, affectedTurns: [], selectedFiles: [], restoreEntry: null };

  sg.lock();
  try {
    let safetyCommit: string;
    const existingEntry = readRestoreEntry(sg.gitDir, sessionId);

    if (existingEntry && existingEntry.throughTurnId === turnId && existingEntry.safetyCommit) {
      safetyCommit = existingEntry.safetyCommit;
    } else {
      safetyCommit = sg.commit(commitMsg(sessionId, turnId, 'revert-safety'));
    }

    sg.checkoutFiles(baseline, selectedFiles);

    const combinedFiles = existingEntry && existingEntry.throughTurnId === turnId
      ? [...new Set([...existingEntry.selectedFiles, ...selectedFiles])]
      : selectedFiles;

    const entry: CodeRestoreEntry = {
      id: createHash('sha256').update(`${sessionId}-${turnId}-${Date.now()}`).digest('hex').slice(0, 12),
      sessionId,
      action,
      throughTurnId: turnId,
      baseTurnId: turnId,
      affectedTurns: [],
      selectedFiles: combinedFiles,
      safetyCommit,
      timestamp: new Date().toISOString(),
    };
    writeRestoreEntry(sg.gitDir, sessionId, entry);

    return { reverted: true, throughTurnId: turnId, baseTurnId: turnId, affectedTurns: [], selectedFiles: combinedFiles, restoreEntry: entry };
  } finally {
    sg.unlock();
  }
}

// ---- Service ----

export class CheckpointService extends Effect.Service<CheckpointService>()('Checkpoint', {
  effect: Effect.gen(function* () {
    const hooks = yield* HookService;
    bootstrapCheckpoint(hooks);

    let _sg: ShadowGit | null = null;
    let _ledger: Ledger | null = null;
    let _ledgerGitDir: string | null = null;

    function ensure(projectPath: string): ShadowGit {
      const normalized = normalizePath(projectPath);
      if (!_sg || _sg.projectPath !== normalized) {
        _sg = new ShadowGit(normalized);
        _sg.init();
      }
      return _sg;
    }

    function ledger(sg: ShadowGit): Ledger {
      if (!_ledger || _ledgerGitDir !== sg.gitDir) {
        _ledger = new Ledger(dirname(sg.gitDir));
        _ledgerGitDir = sg.gitDir;
      }
      return _ledger;
    }

    return {
      // ---- Snapshot methods (unchanged) ----

      snapshotBaseline: (projectPath: string, sessionId: string, turnId: number, title?: string): void => {
        const sg = ensure(projectPath);
        const msg = title ? `${commitMsg(sessionId, turnId, 'baseline')} ${title}` : commitMsg(sessionId, turnId, 'baseline');
        sg.lock();
        try { sg.commit(msg); }
        finally { sg.unlock(); }
      },

      snapshotFinal: (projectPath: string, sessionId: string, turnId: number): void => {
        const sg = ensure(projectPath);
        sg.lock();
        try { sg.commit(commitMsg(sessionId, turnId, 'final')); }
        finally { sg.unlock(); }
      },

      classifyChanges: (
        projectPath: string, sessionId: string, turnId: number,
      ): { agentModified: string[]; unknownSource: string[] } | null => {
        const sg = ensure(projectPath);
        return classifySafe(projectPath, sessionId, turnId, sg);
      },

      getCompletedTurns: (projectPath: string, sessionId: string): number[] => {
        const sg = ensure(projectPath);
        return getCompletedTurnsFor(sg, sessionId);
      },

      getCheckpoints: (
        projectPath: string, sessionId: string,
      ): Array<{ turnId: number; title: string; agentModified: string[]; unknownSource: string[] }> => {
        const sg = ensure(projectPath);
        const prefix = `turn-${shortSid(sessionId)}-`;
        const result: Array<{ turnId: number; title: string; agentModified: string[]; unknownSource: string[] }> = [];
        for (let i = 1; i <= 10000; i++) {
          const bCommit = sg.findCommitByMessage(`${prefix}${i}-baseline`);
          const fCommit = sg.findCommitByMessage(`${prefix}${i}-final`);
          if (!bCommit || !fCommit) { if (result.length === 0 && i === 1) continue; else break; }
          const msgResult = sg.git('log', '--all', '--grep', `${prefix}${i}-baseline`, '--format=%s', '-1');
          const fullMsg = msgResult.stdout.trim();
          const title = fullMsg.includes(' ') ? fullMsg.split(' ').slice(1).join(' ') : '';

          const allChanges = sg.diffFiles(bCommit, fCommit);
          const allFiles = [...new Set(allChanges.map((c) => normalizePath(resolve(projectPath, c.file)).toLowerCase()))];
          const agentFiles = new Set(ledger(sg).getAgentFiles(i, sessionId).map((p) => normalizePath(p).toLowerCase()));

          result.push({
            turnId: i,
            title,
            agentModified: allFiles.filter((f) => agentFiles.has(f)),
            unknownSource: allFiles.filter((f) => !agentFiles.has(f)),
          });
        }
        return result;
      },

      // ---- B1: getCheckpointDiff ----

      getCheckpointDiff: (projectPath: string, sessionId: string, turnId?: number): CheckpointDiff => {
        const sg = ensure(projectPath);
        const completedTurns = getCompletedTurnsFor(sg, sessionId);
        const latestTurnId = turnId ?? (completedTurns.length > 0 ? completedTurns[completedTurns.length - 1] : 0);
        if (latestTurnId === 0) return { turnId: 0, files: [] };

        const baseline = sg.findCommitByMessage(commitMsg(sessionId, latestTurnId, 'baseline'));
        const final = sg.findCommitByMessage(commitMsg(sessionId, latestTurnId, 'final'));
        if (!baseline || !final) return { turnId: latestTurnId, files: [] };

        const allChanges = sg.diffFiles(baseline, final);
        const allFiles = [...new Set(allChanges.map((c) => normalizePath(resolve(projectPath, c.file)).toLowerCase()))];
        const agentFiles = new Set(ledger(sg).getAgentFiles(latestTurnId, sessionId).map((p) => normalizePath(p).toLowerCase()));

        const files = allFiles.map((f) => {
          const relPath = toGitPath(projectPath, f);
          const diffResult = sg.git('diff', baseline, final, '--', relPath);
          const rawPath = normalizePath(resolve(projectPath, relPath)).toLowerCase();
          return {
            path: f,
            source: (agentFiles.has(f) ? 'agent' : 'unknown') as 'agent' | 'unknown',
            status: allChanges.find((c) => normalizePath(resolve(projectPath, c.file)).toLowerCase() === rawPath)?.status ?? 'M',
            diff: diffResult.stdout,
          };
        });

        return { turnId: latestTurnId, files };
      },

      // ---- B2: revertCheckpointFile / revertCheckpointFiles ----

      revertCheckpointFile: (
        projectPath: string, sessionId: string, turnId: number, file: string,
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        return revertFilesImpl(projectPath, sessionId, turnId, [file], 'checkpoint-file', sg);
      },

      revertCheckpointFiles: (
        projectPath: string, sessionId: string, turnId: number, files: string[],
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        return revertFilesImpl(projectPath, sessionId, turnId, files, 'checkpoint-files', sg);
      },

      // ---- B3: revertCheckpointAgentFiles / revertCheckpointAllFiles ----

      revertCheckpointAgentFiles: (
        projectPath: string, sessionId: string, turnId: number,
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const changes = classifySafe(projectPath, sessionId, turnId, sg);
        if (!changes) return { reverted: false, throughTurnId: turnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
        if (changes.agentModified.length === 0) return { reverted: false, throughTurnId: turnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
        return revertFilesImpl(projectPath, sessionId, turnId, changes.agentModified, 'checkpoint-agent', sg);
      },

      revertCheckpointAllFiles: (
        projectPath: string, sessionId: string, turnId: number,
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const changes = classifySafe(projectPath, sessionId, turnId, sg);
        if (!changes) return { reverted: false, throughTurnId: turnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
        const all = [...changes.agentModified, ...changes.unknownSource];
        if (all.length === 0) return { reverted: false, throughTurnId: turnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
        return revertFilesImpl(projectPath, sessionId, turnId, all, 'checkpoint-all', sg);
      },

      // ---- B4: previewRollbackDiff ----

      previewRollbackDiff: (
        projectPath: string, sessionId: string, throughTurnId: number,
      ): RollbackPreviewDiff => {
        const sg = ensure(projectPath);
        const completedTurns = getCompletedTurnsFor(sg, sessionId);
        const affectedTurns = completedTurns.filter((id) => id > throughTurnId);
        if (affectedTurns.length === 0) {
          return { throughTurnId, baseTurnId: null, affectedTurns: [], diff: '' };
        }

        const baseTurnId = affectedTurns[0]! - 1;
        const baseline = sg.findCommitByMessage(commitMsg(sessionId, baseTurnId, 'baseline'));
        if (!baseline) {
          return { throughTurnId, baseTurnId, affectedTurns, diff: '' };
        }

        const result = sg.git('diff', baseline);
        return { throughTurnId, baseTurnId, affectedTurns, diff: result.stdout };
      },

      // ---- B5: rollbackCodeToTurn ----

      rollbackCodeToTurn: (
        projectPath: string, sessionId: string, throughTurnId: number,
      ): CodeRollbackResult => {
        const sg = ensure(projectPath);
        const completedTurns = getCompletedTurnsFor(sg, sessionId);
        const affectedTurns = completedTurns.filter((id) => id > throughTurnId);
        if (affectedTurns.length === 0) {
          return { reverted: true, throughTurnId, baseTurnId: null, affectedTurns: [], selectedFiles: [], restoreEntry: null };
        }

        const baseTurnId = affectedTurns[0]! - 1;
        const baseline = sg.findCommitByMessage(commitMsg(sessionId, baseTurnId, 'baseline'));
        if (!baseline) {
          return { reverted: false, throughTurnId, baseTurnId, affectedTurns: [], selectedFiles: [], restoreEntry: null };
        }

        const diffResult = sg.git('diff', '--name-only', baseline);
        const selectedFiles = diffResult.stdout.trim().split('\n').filter(Boolean)
          .map((f) => resolve(projectPath, f));

        if (selectedFiles.length === 0) {
          return { reverted: true, throughTurnId, baseTurnId, affectedTurns, selectedFiles: [], restoreEntry: null };
        }

        sg.lock();
        try {
          const safetyCommit = sg.commit(commitMsg(sessionId, throughTurnId, 'rollback-safety'));
          sg.checkoutFiles(baseline, selectedFiles);

          const entry: CodeRestoreEntry = {
            id: createHash('sha256').update(`${sessionId}-${Date.now()}`).digest('hex').slice(0, 12),
            sessionId,
            action: 'rollback-to-turn',
            throughTurnId,
            baseTurnId,
            affectedTurns,
            selectedFiles,
            safetyCommit,
            timestamp: new Date().toISOString(),
          };
          writeRestoreEntry(sg.gitDir, sessionId, entry);

          return { reverted: true, throughTurnId, baseTurnId, affectedTurns, selectedFiles, restoreEntry: entry };
        } finally {
          sg.unlock();
        }
      },

      // ---- B6: undoLastCodeRollback ----

      undoLastCodeRollback: (
        projectPath: string, sessionId: string,
        opts?: { force?: boolean; files?: string[] },
      ): CodeRollbackUndoResult => {
        const sg = ensure(projectPath);
        const entry = readRestoreEntry(sg.gitDir, sessionId);
        if (!entry) {
          return { restored: false, conflict: false, conflictFiles: [], restoredFiles: [], remainingRolledBack: [] };
        }

        const filesToRestore = opts?.files && opts.files.length > 0
          ? entry.selectedFiles.filter((f) => opts.files!.includes(f))
          : [...entry.selectedFiles];

        if (filesToRestore.length === 0) {
          return { restored: false, conflict: false, conflictFiles: [], restoredFiles: [], remainingRolledBack: entry.selectedFiles };
        }

        // Conflict detection: compare current workspace files against baseline commit.
        // After revert, files should equal baseline. Any divergence = conflict.
        const baselineCommit = sg.findCommitByMessage(commitMsg(sessionId, entry.baseTurnId, 'baseline'));
        const conflictFiles: string[] = [];

        if (baselineCommit) {
          for (const f of filesToRestore) {
            const gitPath = toGitPath(projectPath, f);
            const currentHash = hashWorkspaceFile(projectPath, f);
            const baselineContent = sg.showFile(baselineCommit, gitPath);
            const baselineHash = baselineContent !== null
              ? createHash('sha256').update(baselineContent).digest('hex')
              : null;

            if (currentHash !== baselineHash) {
              conflictFiles.push(f);
            }
          }
        }

        if (conflictFiles.length > 0 && !opts?.force) {
          return {
            restored: false, conflict: true, conflictFiles,
            restoredFiles: [], remainingRolledBack: entry.selectedFiles,
          };
        }

        sg.lock();
        try {
          sg.checkoutFiles(entry.safetyCommit, filesToRestore);

          const remainingFiles = entry.selectedFiles.filter((f) => !filesToRestore.includes(f));
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
