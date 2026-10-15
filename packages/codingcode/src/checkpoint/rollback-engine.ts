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
  plan: RestorePlan,
  selectedFiles: string[],
  sg: ShadowGit
): CodeRollbackResult {
  if (selectedFiles.length === 0) {
    return {
      reverted: false,
      throughTurnId: plan.throughTurnId,
      affectedTurns: plan.affectedTurns,
      selectedFiles: [],
    };
  }

  sg.checkoutFiles(plan.baseline, selectedFiles);
  // restore 只写工作区：被删的新文件会残留 index 条目（diff 面板会多出 D 行），
  // 恢复的文件若是 untracked 也不会进 index（diff 面板丢文件）。stageAll 对齐。
  sg.stageAll();

  return {
    reverted: true,
    throughTurnId: plan.throughTurnId,
    affectedTurns: plan.affectedTurns,
    selectedFiles,
  };
}
