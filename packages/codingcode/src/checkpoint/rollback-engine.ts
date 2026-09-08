import type { ShadowGit } from './shadow-git.js';
import type { ProjectLock } from './project-lock.js';
import type { CodeRollbackResult, RestorePlan } from './types.js';

export function emptyRollbackResult(turnId: number): CodeRollbackResult {
  return {
    reverted: false,
    throughTurnId: turnId,
    affectedTurns: [],
    selectedFiles: [],
  };
}

export function executeRollback(
  plan: RestorePlan,
  selectedFiles: string[],
  sg: ShadowGit,
  lock: ProjectLock
): CodeRollbackResult {
  if (selectedFiles.length === 0) {
    return {
      reverted: false,
      throughTurnId: plan.throughTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles: [],
    };
  }

  lock.lock();
  try {
    sg.checkoutFiles(plan.baseline, selectedFiles);

    return {
      reverted: true,
      throughTurnId: plan.throughTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles,
    };
  } finally {
    lock.unlock();
  }
}
