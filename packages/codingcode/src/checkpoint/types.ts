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
}

export interface RollbackPreviewDiff {
  throughTurnId: number;
  affectedTurns: number[];
  diff: string;
}

export interface RestorePlan {
  throughTurnId: number;
  affectedTurns: number[];
  baseline: string;
}
