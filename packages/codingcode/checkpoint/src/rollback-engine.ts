import type { ShadowGit } from './shadow-git.js';
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
  sg: ShadowGit,
  cmd: { readonly plan: RestorePlan; readonly selectedFiles: readonly string[] }
): CodeRollbackResult {
  const { plan, selectedFiles } = cmd;
  if (selectedFiles.length === 0) {
    return {
      reverted: false,
      throughTurnId: plan.throughTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles: [],
    };
  }

  sg.checkoutFiles(plan.baseline, selectedFiles);
  sg.stageAll();

  return {
    reverted: true,
    throughTurnId: plan.throughTurnId,
    affectedTurns: plan.affectedTurns,
    selectedFiles: [...selectedFiles],
  };
}
