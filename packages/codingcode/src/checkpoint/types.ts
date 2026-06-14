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

export interface RestorePlan {
  throughTurnId: number;
  affectedTurns: number[];
  baseline: string;
}

export interface RollbackState {
  context: { active: boolean; currentThroughTurnId: number | null };
  code: {
    canUndoLast: boolean;
    lastEntry: CodeRestoreEntry | null;
    revertedFiles: string[];
    lastEntryId: string | null;
  };
}
