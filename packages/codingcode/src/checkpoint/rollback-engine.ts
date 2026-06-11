import { createHash } from 'crypto';
import { normalizePath } from '../core/path.js';
import type { ShadowGit } from './shadow-git.js';
import type { ProjectLock } from './project-lock.js';
import type { CodeRollbackResult, CodeRestoreEntry } from './checkpoint-service.js';
import { commitMsg } from './commit-naming.js';
import { readRestoreEntry, writeRestoreEntry } from './restore-store.js';

export function emptyRollbackResult(
  turnId: number
): CodeRollbackResult {
  return {
    reverted: false,
    throughTurnId: turnId,
    affectedTurns: [],
    selectedFiles: [],
    restoreEntry: null,
  };
}

export function executeRollback(
  sessionId: string,
  plan: { throughTurnId: number; affectedTurns: number[]; baseline: string },
  selectedFiles: string[],
  action: CodeRestoreEntry['action'],
  sg: ShadowGit,
  lock: ProjectLock
): CodeRollbackResult {
  if (selectedFiles.length === 0) {
    return {
      reverted: false,
      throughTurnId: plan.throughTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles: [],
      restoreEntry: null,
    };
  }

  lock.lock();
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
      affectedTurns: plan.affectedTurns,
      selectedFiles: combinedFiles,
      safetyCommit,
      timestamp: new Date().toISOString(),
    };
    writeRestoreEntry(sg.gitDir, sessionId, entry);

    sg.checkoutFiles(plan.baseline, selectedFiles);

    return {
      reverted: true,
      throughTurnId: plan.throughTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles: combinedFiles,
      restoreEntry: entry,
    };
  } finally {
    lock.unlock();
  }
}
